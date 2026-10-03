import outerLimits from '@/test/fixtures/internetArchive/outer-limits-s2-archive-torrent.json';
import { isVideo } from '@/utils/selectable';

/**
 * The real torrent of an Internet Archive season upload: seventeen episodes,
 * each an uploaded .mkv beside the compressed .mp4 the Archive derives from it
 * under the same name, plus padding files and cover art.
 */
export const OUTER_LIMITS = outerLimits;

export type ArchiveFile = (typeof outerLimits.files)[number];

/** The torrent's video files, in torrent order: source, derivative, source, ... */
export const outerLimitsVideos = (): ArchiveFile[] =>
	outerLimits.files.filter((file) => isVideo({ path: file.path }));

/** Largest first, which is the order the PM, OC and DL file helpers hand back. */
export const outerLimitsVideosBiggestFirst = (): ArchiveFile[] =>
	[...outerLimitsVideos()].sort((a, b) => b.bytes - a.bytes);

/**
 * The rows a cast table ends up holding after a run of save calls. The tables
 * are unique on `(imdbId, userId, hash)`, so a later save to the same key
 * replaces the earlier one - which is the whole defect, and a call count alone
 * would not show which file survived.
 */
export const survivingCastRows = (
	calls: unknown[][],
	keyArg = 0,
	filenameArg = 3
): Map<string, string> => {
	const rows = new Map<string, string>();
	for (const call of calls) rows.set(String(call[keyArg]), String(call[filenameArg]));
	return rows;
};
