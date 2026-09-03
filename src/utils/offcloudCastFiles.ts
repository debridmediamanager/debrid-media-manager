import { isVideo } from '@/utils/selectable';

export interface OffcloudVideoFile {
	/** `folder/filename` when Offcloud reported a folder, the bare name otherwise. */
	path: string;
	filename: string;
	size: number;
	/**
	 * The signed energycdn URL, when this listing came from `cloud/explore`.
	 * `null` for a listing built from `cache/info`, which names files and sizes
	 * but mints nothing.
	 *
	 * NEVER log one of these or render it into anything cacheable: the URL path
	 * carries an **account-scoped token**, stable across files and across mints,
	 * so the link is a credential as much as a location.
	 */
	link: string | null;
}

/** What either Offcloud listing endpoint can contribute about one file. */
export interface OffcloudFileLike {
	filename: string;
	folder?: string | null;
	size?: number | null;
	link?: string | null;
}

const basename = (path: string) => path.split('/').pop() || path;

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, '');

/**
 * The path a cast row stores for a file.
 *
 * `cache/info` reports `folder` and `filename` separately, and `cloud/explore`
 * reports neither - only a URL whose last segment is the encoded filename. So
 * the path is a best effort that degrades to the bare filename, which is why
 * `matchOffcloudFile` falls back to a basename comparison.
 */
export const offcloudFilePath = (filename: string, folder?: string | null): string => {
	const name = trimSlashes(filename);
	const dir = trimSlashes(folder ?? '');
	if (!dir || dir === '.') return name;
	if (dir === name || dir.endsWith(`/${name}`)) return dir;
	return `${dir}/${name}`;
};

/**
 * The video files of an Offcloud listing, largest first.
 *
 * Largest first because `cloud/explore` returns Offcloud's own order, not a
 * useful one - a first-file pick hands the user whatever sorts first, which in
 * the reference release is a poster. Files with no size (an explore listing
 * whose `cache/info` companion failed) sort last rather than winning by
 * accident.
 */
export const offcloudVideoFiles = (files: OffcloudFileLike[]): OffcloudVideoFile[] =>
	files
		.filter((file) => !!file.filename && isVideo({ path: file.filename }))
		.map((file) => ({
			path: offcloudFilePath(file.filename, file.folder),
			filename: basename(file.filename),
			size: typeof file.size === 'number' ? file.size : 0,
			link: file.link ?? null,
		}))
		.sort((a, b) => b.size - a.size);

/**
 * Finds the file a cast row points at.
 *
 * Matched on the stored `path` first and the basename second: a re-resolve can
 * surface the same release without its folder at all, because `cloud/explore`
 * carries no folder and the `cache/info` call that would supply one is allowed
 * to fail.
 */
export const matchOffcloudFile = (
	files: OffcloudVideoFile[],
	target: string | null | undefined
): OffcloudVideoFile | undefined => {
	if (!target) return files[0];

	const exact = files.find((file) => file.path === target);
	if (exact) return exact;

	const wanted = basename(target).toLowerCase();
	return files.find((file) => file.filename.toLowerCase() === wanted);
};
