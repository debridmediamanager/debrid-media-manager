import { flattenMagnetFiles, getMagnetFiles } from '@/services/allDebrid';
import { type UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import {
	checkAvailabilityAdByHashes,
	checkAvailabilityByHashes,
	checkAvailabilityDl,
	recordDlAvailability,
	submitAvailability,
	submitAvailabilityAd,
} from './availability';
import type { LibraryIdentification } from './libraryIdentify';
import { mostlyVideo } from './selectable';
import { generateTokenAndHash } from './token';

export type LibraryItem = Pick<UserTorrent, 'id' | 'hash' | 'serviceStatus' | 'adData'> &
	Partial<Pick<UserTorrent, 'status'>>;

/** The availability check routes take 100 hashes a call. */
const CHECK_BATCH = 100;
/** Magnets per AllDebrid magnet/files call. */
const AD_FILES_BATCH = 20;
// ponytail: one torrents/info a second leaves RD room for the page's own calls; a fresh
// 5,000-release library takes ~80 min on its first visit, later visits only the new ones.
// Debrid-Link gets the same pace: its hour-long lockout came after ~3,600 adds in 3 minutes.
const PACE_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ReportDeps {
	adFiles: typeof getMagnetFiles;
	rdRecorded: typeof checkAvailabilityByHashes;
	adRecorded: typeof checkAvailabilityAdByHashes;
	rdSubmit: typeof submitAvailability;
	adSubmit: typeof submitAvailabilityAd;
	dlRecorded: (
		key: string,
		solution: string,
		hashes: string[]
	) => ReturnType<typeof checkAvailabilityDl>;
	dlRecord: typeof recordDlAvailability;
	token: typeof generateTokenAndHash;
	wait: (ms: number) => Promise<unknown>;
}

const DEFAULT_DEPS: ReportDeps = {
	adFiles: getMagnetFiles,
	rdRecorded: checkAvailabilityByHashes,
	adRecorded: checkAvailabilityAdByHashes,
	rdSubmit: submitAvailability,
	adSubmit: submitAvailabilityAd,
	// by hash alone, so a row filed under another title still counts as recorded
	dlRecorded: (key, solution, hashes) => checkAvailabilityDl(key, solution, hashes),
	dlRecord: recordDlAvailability,
	token: generateTokenAndHash,
	wait: sleep,
};

/** Which availability table a library item belongs in: finished on its provider = cached there. */
export function cachedOn(t: LibraryItem): 'rd' | 'ad' | 'dl' | null {
	if (!/^[a-f0-9]{40}$/i.test(t.hash)) return null;
	if (t.id.startsWith('rd:') && t.serviceStatus === 'downloaded') return 'rd';
	if (t.id.startsWith('ad:') && t.serviceStatus === '4' && t.adData?.status === 'Ready')
		return 'ad';
	if (t.id.startsWith('dl:') && t.status === UserTorrentStatus.finished) return 'dl';
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
	keys: { rd?: string | null; ad?: string | null; dl?: string | null },
	deps: ReportDeps = DEFAULT_DEPS
): Promise<void> {
	const named = items.filter((t) => /^tt\d+$/.test(found[t.id]?.imdbId ?? ''));
	const rd = keys.rd ? named.filter((t) => cachedOn(t) === 'rd') : [];
	const ad = keys.ad ? named.filter((t) => cachedOn(t) === 'ad') : [];
	const dl = keys.dl ? named.filter((t) => cachedOn(t) === 'dl') : [];

	// side by side: each provider would otherwise wait out another's paced run
	await Promise.all([
		reportRd(rd, found, keys.rd!, deps),
		reportAd(ad, found, keys.ad!, deps),
		reportDl(dl, found, deps),
	]);
}

/** DMM asks Debrid-Link itself for each new release (`/api/availability/dl`). */
async function reportDl(
	dl: LibraryItem[],
	found: Record<string, LibraryIdentification>,
	deps: ReportDeps
): Promise<void> {
	if (dl.length === 0) return;
	try {
		for (const t of await unrecorded(dl, deps.dlRecorded, deps.token)) {
			try {
				await deps.dlRecord(found[t.id].imdbId, t.hash);
			} catch {
				// a release DMM could not confirm stays unrecorded; a later visit asks again
			}
			await deps.wait(PACE_MS);
		}
	} catch {
		// the check itself failed: nothing is sent rather than duplicates
	}
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
				const [key, solution] = await deps.token();
				// DMM reads the torrent from RD and refuses anything not downloaded, partly
				// expired or mostly not video
				await deps.rdSubmit(key, solution, rdKey, t.id.slice(3), found[t.id].imdbId);
			} catch {
				// a release RD no longer answers for, or refused, stays unrecorded
			}
			await deps.wait(PACE_MS);
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
