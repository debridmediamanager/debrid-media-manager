import { flattenMagnetFiles, getMagnetFiles } from '@/services/allDebrid';
import { getTorrentInfo } from '@/services/realDebrid';
import type { UserTorrent } from '@/torrent/userTorrent';
import {
	checkAvailabilityAdByHashes,
	checkAvailabilityByHashes,
	submitAvailability,
	submitAvailabilityAd,
} from './availability';
import type { LibraryIdentification } from './libraryIdentify';
import { isVideo } from './selectable';
import { generateTokenAndHash } from './token';

export type LibraryItem = Pick<UserTorrent, 'id' | 'hash' | 'serviceStatus' | 'adData'>;

/** The availability check routes take 100 hashes a call. */
const CHECK_BATCH = 100;
/** Magnets per AllDebrid magnet/files call. */
const AD_FILES_BATCH = 20;
// ponytail: one torrents/info a second leaves RD room for the page's own calls; a fresh
// 5,000-release library takes ~80 min on its first visit, later visits only the new ones
const RD_PACE_MS = 1000;

/**
 * Films and shows only: most of the release's bytes are video. A name can read as a title
 * without being one; AD's "music" folder came back "Music (2021)", and its one bonus .mpg
 * among 104 GB of audio is why any single video file is not enough. isVideo also takes the
 * audio it can play.
 */
export function mostlyVideo(files: { path: string; bytes: number }[]): boolean {
	const bytes = (list: typeof files) => list.reduce((sum, f) => sum + (f.bytes || 0), 0);
	const video = files.filter((f) => isVideo(f) && !/\.(mp3|flac|m4a)$/i.test(f.path));
	return bytes(video) * 2 > bytes(files);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ReportDeps {
	rdInfo: typeof getTorrentInfo;
	adFiles: typeof getMagnetFiles;
	rdRecorded: typeof checkAvailabilityByHashes;
	adRecorded: typeof checkAvailabilityAdByHashes;
	rdSubmit: typeof submitAvailability;
	adSubmit: typeof submitAvailabilityAd;
	token: typeof generateTokenAndHash;
	wait: (ms: number) => Promise<unknown>;
}

const DEFAULT_DEPS: ReportDeps = {
	rdInfo: getTorrentInfo,
	adFiles: getMagnetFiles,
	rdRecorded: checkAvailabilityByHashes,
	adRecorded: checkAvailabilityAdByHashes,
	rdSubmit: submitAvailability,
	adSubmit: submitAvailabilityAd,
	token: generateTokenAndHash,
	wait: sleep,
};

/** Which availability table a library item belongs in: finished on its provider = cached there. */
export function cachedOn(t: LibraryItem): 'rd' | 'ad' | null {
	if (!/^[a-f0-9]{40}$/i.test(t.hash)) return null;
	if (t.id.startsWith('rd:') && t.serviceStatus === 'downloaded') return 'rd';
	if (t.id.startsWith('ad:') && t.serviceStatus === '4' && t.adData?.status === 'Ready')
		return 'ad';
	return null;
}

/** The items whose hash DMM has no availability row for yet; an existing row is left as it is. */
async function unrecorded(
	items: LibraryItem[],
	recorded: (key: string, solution: string, hashes: string[]) => Promise<any>,
	token: ReportDeps['token']
): Promise<LibraryItem[]> {
	const known = new Set<string>();
	for (let at = 0; at < items.length; at += CHECK_BATCH) {
		const [key, solution] = await token();
		const { available } = await recorded(
			key,
			solution,
			items.slice(at, at + CHECK_BATCH).map((t) => t.hash.toLowerCase())
		);
		for (const row of available ?? []) known.add(String(row.hash).toLowerCase());
	}
	return items.filter((t) => !known.has(t.hash.toLowerCase()));
}

/**
 * Record the cached releases of a user's own library in DMM's availability tables, so the
 * movie and show pages list them as available for everyone. Only releases the identifier
 * named under an IMDb id are sent, and only ones DMM has no row for, so a visit costs the
 * provider one info call per release DMM has never seen. Each release goes through the
 * same token-guarded routes and checks as an add from a title page. Failures are skipped:
 * this is a contribution, never something the library waits on.
 */
export async function reportLibraryAvailability(
	items: LibraryItem[],
	found: Record<string, LibraryIdentification>,
	keys: { rd?: string | null; ad?: string | null },
	deps: ReportDeps = DEFAULT_DEPS
): Promise<void> {
	const named = items.filter((t) => /^tt\d+$/.test(found[t.id]?.imdbId ?? ''));
	const rd = keys.rd ? named.filter((t) => cachedOn(t) === 'rd') : [];
	const ad = keys.ad ? named.filter((t) => cachedOn(t) === 'ad') : [];

	// side by side: AD would otherwise wait out the whole paced RD run
	await Promise.all([reportRd(rd, found, keys.rd!, deps), reportAd(ad, found, keys.ad!, deps)]);
}

async function reportRd(
	rd: LibraryItem[],
	found: Record<string, LibraryIdentification>,
	rdKey: string,
	deps: ReportDeps
): Promise<void> {
	if (rd.length === 0) return;
	try {
		for (const t of await unrecorded(rd, deps.rdRecorded, deps.token)) {
			try {
				const info = await deps.rdInfo(rdKey, t.id.slice(3));
				if (mostlyVideo((info.files ?? []).filter((f) => f.selected === 1))) {
					const [key, solution] = await deps.token();
					// the route itself refuses anything not downloaded or partly expired
					await deps.rdSubmit(key, solution, info, found[t.id].imdbId);
				}
			} catch {
				// a release RD no longer answers for stays unrecorded
			}
			await deps.wait(RD_PACE_MS);
		}
	} catch {
		// the check itself failed: nothing is sent rather than duplicates
	}
}

async function reportAd(
	ad: LibraryItem[],
	found: Record<string, LibraryIdentification>,
	adKey: string,
	deps: ReportDeps
): Promise<void> {
	if (ad.length === 0) return;
	try {
		const todo = await unrecorded(ad, deps.adRecorded, deps.token);
		for (let at = 0; at < todo.length; at += AD_FILES_BATCH) {
			const batch = todo.slice(at, at + AD_FILES_BATCH);
			try {
				const { magnets } = await deps.adFiles(
					adKey,
					batch.map((t) => Number(t.id.slice(3)))
				);
				for (const magnet of magnets ?? []) {
					// magnet/files answers the id as a string, magnet/status as a number
					const t = batch.find((b) => b.id.slice(3) === String(magnet.id));
					const status = t?.adData;
					if (!t || !status || magnet.error) continue;
					const files = flattenMagnetFiles(magnet.files ?? [])
						.filter((f) => f.n && f.s)
						.map((f) => ({ n: f.n, s: f.s!, l: f.l || '' }));
					if (!mostlyVideo(files.map((f) => ({ path: f.n, bytes: f.s })))) continue;
					const [key, solution] = await deps.token();
					await deps
						.adSubmit(key, solution, {
							hash: t.hash.toLowerCase(),
							imdbId: found[t.id].imdbId,
							filename: status.filename,
							size: status.size,
							status: status.status,
							statusCode: status.statusCode,
							completionDate: status.completionDate || 0,
							files,
						})
						.catch(() => undefined);
				}
			} catch {
				// this batch stays unrecorded; a later visit asks again
			}
		}
	} catch {
		// the check itself failed: nothing is sent rather than duplicates
	}
}
