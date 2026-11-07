/**
 * Whether a stored release is a program posing as one: malware filed as a new
 * episode or film (`Ted Lasso S04E04 1080p HEVC x265-MeGusta .exe`).
 *
 * The name check takes `exe` after a dot, space, `_` or `-` (the scrapers' copies
 * drop the dot: `... EZTV exe`), and the other program extensions only after a
 * dot, so `The Bat` stays a film. Size separates the two meanings of `.EXE`:
 * every fake measured on 2026-11-07 (1,459 blocked hashes, 294 trashed entries)
 * was at most 2.2 GB, while `Rockman.EXE` is a 48 GB series pack. An unknown size
 * counts as small. Sizes are MB, as pages store them.
 */
const EXECUTABLE_NAME = /(?:[.\s_-]exe|\.(?:scr|msi|lnk|bat|cmd))\s*$/i;
const LARGEST_FAKE_MB = 4096;

export type StoredRelease = {
	title?: unknown;
	/** anime pages store the name and size as `filename` and `size_bytes` (MB) */
	filename?: unknown;
	fileSize?: unknown;
	size_bytes?: unknown;
};

export function isExecutableRelease(row: StoredRelease | null | undefined): boolean {
	const name = typeof row?.title === 'string' ? row.title : row?.filename;
	if (typeof name !== 'string' || !EXECUTABLE_NAME.test(name)) return false;
	const size = Number(row?.fileSize ?? row?.size_bytes);
	return !(size >= LARGEST_FAKE_MB);
}
