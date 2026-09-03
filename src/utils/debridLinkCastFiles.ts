import { isVideo } from '@/utils/selectable';

export interface DebridLinkVideoFile {
	/** The file's path inside the release, exactly as Debrid-Link named it. */
	path: string;
	filename: string;
	size: number;
	/**
	 * The file's Debrid-Link download URL.
	 *
	 * `https://seed41.debrid.link/dl/<torrent id>-<index>/<decorative name>` -
	 * no token, no signature, no timestamp, no user id. The torrent id is the
	 * whole capability, it serves any IP, and it keeps serving after the torrent
	 * is deleted. Treat one as a credential: never log it, never render it into
	 * anything cacheable, never hand it to a client that only asked for a
	 * listing.
	 *
	 * `null` for a file Debrid-Link listed without one, which is what an
	 * unfinished torrent's file list looks like.
	 */
	link: string | null;
	/** Per-file completion. `downloaded` is NOT this - it tracks user fetches. */
	percent: number;
}

/** What a Debrid-Link torrent's file list contributes about one file. */
export interface DebridLinkFileLike {
	name?: string | null;
	size?: number | null;
	downloadUrl?: string | null;
	downloadPercent?: number | null;
}

const basename = (path: string) => path.split('/').pop() || path;

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, '');

/**
 * The video files of a Debrid-Link torrent, largest first.
 *
 * Largest first for the same reason as every sibling: Debrid-Link returns its
 * own ordering, and a first-file pick hands the user whatever happens to sort
 * first, which in a real release is as likely to be a sample as the feature.
 *
 * This module is pure on purpose - it never calls Debrid-Link. Every network
 * touch lives in `debridLinkCastApiHelpers`, which matters more here than for
 * the other providers: Debrid-Link punishes a request loop with an hour-long
 * lockout of the whole endpoint, so a helper that could quietly issue a call
 * from inside a render or a loop is a hazard rather than a convenience.
 */
export const debridLinkVideoFiles = (files: DebridLinkFileLike[]): DebridLinkVideoFile[] =>
	files
		.filter((file) => !!file.name && isVideo({ path: file.name }))
		.map((file) => {
			const path = trimSlashes(file.name ?? '');
			return {
				path,
				filename: basename(path),
				size: typeof file.size === 'number' ? file.size : 0,
				link: file.downloadUrl || null,
				percent: typeof file.downloadPercent === 'number' ? file.downloadPercent : 0,
			};
		})
		.sort((a, b) => b.size - a.size);

/**
 * Finds the file a cast row points at.
 *
 * Matched on the stored `path` first and the basename second. The fallback
 * earns its place because a Debrid-Link release can come back with a different
 * shape than the one that was cast: a torrent with many files lists as a single
 * `isZip: true` entry in the bulk listing and only expands when fetched on its
 * own, so a path recorded from an expanded listing has to still find its file
 * in one that was resolved another way.
 */
export const matchDebridLinkFile = (
	files: DebridLinkVideoFile[],
	target: string | null | undefined
): DebridLinkVideoFile | undefined => {
	if (!target) return files[0];

	const exact = files.find((file) => file.path === target);
	if (exact) return exact;

	const wanted = basename(target).toLowerCase();
	return files.find((file) => file.filename.toLowerCase() === wanted);
};
