import { ScrapeSearchResult } from '@/services/mediasearch';
import { deInfringe } from '@/utils/deInfringe';
import { isVideo } from '@/utils/selectable';
import { clipToVarchar } from '@/utils/varchar';

// Registers a completed TB → RD transfer in DMM's own database so the rewritten
// torrent — which exists nowhere but Real-Debrid (no announce, no DHT) — shows
// up as an RD-cached search result for everyone. The inputs come from the
// debrid uploader service's job record, never from the browser, so a client can
// only influence *where* the row is filed (movie vs tv+season), not what it says.

export interface TransferJobFile {
	name: string;
	size: number;
	rd_link: string | null;
}

export interface TransferContext {
	mediaType: 'movie' | 'tv';
	seasonNum?: number;
}

export interface TransferRegistration {
	scrapedKey: string;
	scrapeEntry: ScrapeSearchResult;
	availability: {
		hash: string;
		imdbId: string;
		filename: string;
		originalFilename: string;
		bytes: number;
		originalBytes: number;
		host: string;
		progress: number;
		status: string;
		ended: string;
		selectedFiles: Array<{ id: number; path: string; bytes: number; selected: number }>;
		links: string[];
	};
}

/** The original torrent hash a job was submitted with, from its magnet input. */
export function originalHashFromInput(input: unknown): string | null {
	if (typeof input !== 'string') return null;
	const match = input.match(/[a-fA-F0-9]{40}/);
	return match ? match[0].toLowerCase() : null;
}

export function parseTransferContext(
	mediaType: unknown,
	seasonNum: unknown
): TransferContext | null {
	if (mediaType === 'movie') return { mediaType: 'movie' };
	if (mediaType === 'tv') {
		const season = typeof seasonNum === 'string' ? parseInt(seasonNum, 10) : NaN;
		if (!Number.isInteger(season) || season < 0) return null;
		return { mediaType: 'tv', seasonNum: season };
	}
	return null;
}

/** The library page a transfer is filed under. */
export function scrapedKeyFor(imdbId: string, context: TransferContext): string {
	return context.mediaType === 'movie' ? `movie:${imdbId}` : `tv:${imdbId}:${context.seasonNum}`;
}

/**
 * A filed transfer's library entry, rebuilt from the `Available` row filed with
 * it: filing stores the same title as that row's `filename` and the size of its
 * `bytes` in MiB.
 */
export function scrapeEntryFromAvailable(row: {
	hash: string;
	filename: string;
	bytes: number | bigint;
}): ScrapeSearchResult {
	return { hash: row.hash.toLowerCase(), title: row.filename, fileSize: mibOf(row.bytes) };
}

const mibOf = (bytes: number | bigint) => Math.round((Number(bytes) / 1024 / 1024) * 100) / 100;

export function buildTransferRegistration(args: {
	infoHash: string | null | undefined;
	imdbId: string | null | undefined;
	name: string | null | undefined;
	files: TransferJobFile[];
	context: TransferContext;
	endedAt?: string | null;
}): TransferRegistration | null {
	const { infoHash, imdbId, name, files, context, endedAt } = args;

	const hash = infoHash?.toLowerCase() ?? '';
	if (!/^[a-f0-9]{40}$/.test(hash)) return null;
	if (!imdbId || !/^tt\d+$/.test(imdbId)) return null;

	// Only files RD actually serves links for are usable; without at least one
	// video among them the row would render as noVideos/unavailable anyway.
	const linked = files.filter((f) => f.rd_link && f.size > 0);
	if (linked.length === 0) return null;
	if (!linked.some((f) => isVideo({ path: f.name }))) return null;

	const biggest = [...linked].sort((a, b) => b.size - a.size)[0];
	const rawTitle = name?.trim() || biggest.name;
	// De-infringe so the stored title matches the RD record and passes the
	// hideRdBlockedTorrents client filter. The page entry and `Available.filename`
	// carry the same title, so it is cut to that column, `varchar(191)`. Cut at
	// 255 instead, a 192-255 character name filed to the page and then failed
	// the `Available` insert, on every retry: debrid02's 249-character "[GSH]"
	// release failed every 5-minute cron tick from 01:35 UTC on 2026-10-06.
	const title = clipToVarchar(deInfringe(rawTitle));
	if (!title) return null;

	const totalBytes = linked.reduce((sum, f) => sum + f.size, 0);

	return {
		scrapedKey: scrapedKeyFor(imdbId, context),
		scrapeEntry: { hash, title, fileSize: mibOf(totalBytes) },
		availability: {
			hash,
			imdbId,
			filename: title,
			originalFilename: clipToVarchar(rawTitle),
			bytes: totalBytes,
			originalBytes: totalBytes,
			host: 'real-debrid.com',
			progress: 100,
			// 'downloaded' is the hard gate /api/availability/check filters on
			status: 'downloaded',
			ended: endedAt || new Date().toISOString(),
			selectedFiles: linked.map((f, i) => ({
				id: i + 1,
				path: f.name,
				bytes: f.size,
				selected: 1,
			})),
			links: linked.map((f) => f.rd_link!),
		},
	};
}
