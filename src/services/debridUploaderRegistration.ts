import { ScrapeSearchResult } from '@/services/mediasearch';
import { deInfringe } from '@/utils/deInfringe';
import { isVideo } from '@/utils/selectable';

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
	// hideRdBlockedTorrents client filter; JSON_TABLE truncates at 255 anyway.
	const title = deInfringe(rawTitle).slice(0, 255);
	if (!title) return null;

	const totalBytes = linked.reduce((sum, f) => sum + f.size, 0);
	const fileSizeMb = Math.round((totalBytes / 1024 / 1024) * 100) / 100;

	return {
		scrapedKey:
			context.mediaType === 'movie' ? `movie:${imdbId}` : `tv:${imdbId}:${context.seasonNum}`,
		scrapeEntry: { hash, title, fileSize: fileSizeMb },
		availability: {
			hash,
			imdbId,
			filename: title,
			originalFilename: rawTitle,
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
