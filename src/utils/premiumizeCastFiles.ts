import { PremiumizeDirectDownloadFile } from '@/services/premiumize';
import { isVideo } from '@/utils/selectable';

export interface PremiumizeVideoFile {
	path: string;
	filename: string;
	size: number;
	link: string;
	streamLink: string | null;
}

const basename = (path: string) => path.split('/').pop() || path;

/**
 * The video files of a directdl response, largest first.
 *
 * `directdl`'s top-level `location`/`filename`/`filesize` mirror `content[0]`,
 * which for a torrent is whatever sorts first in Premiumize's ordering - a
 * poster JPEG in the reference case. Any client written against those fields
 * hands its user an image, so everything here iterates `content`.
 */
export const premiumizeVideoFiles = (
	content: PremiumizeDirectDownloadFile[]
): PremiumizeVideoFile[] =>
	content
		.filter((file) => file.link && isVideo({ path: file.path }))
		.map((file) => ({
			path: file.path,
			filename: basename(file.path),
			size: file.size ?? 0,
			link: file.link,
			streamLink: file.stream_link ?? null,
		}))
		.sort((a, b) => b.size - a.size);

/**
 * Finds the file a cast row points at.
 *
 * Matched on the stored `path` first and the basename second: Premiumize keys
 * a file by its path inside the torrent, but a re-resolve can surface the same
 * release under a different parent folder.
 */
export const matchPremiumizeFile = (
	files: PremiumizeVideoFile[],
	target: string | null | undefined
): PremiumizeVideoFile | undefined => {
	if (!target) return files[0];

	const exact = files.find((file) => file.path === target);
	if (exact) return exact;

	const wanted = basename(target).toLowerCase();
	return files.find((file) => file.filename.toLowerCase() === wanted);
};

/**
 * The URL to hand a player.
 *
 * `stream_link` is Premiumize's transcoded rendition and is only present for
 * files it decided to transcode; `link` is the original and is always there.
 */
export const premiumizePlaybackUrl = (file: PremiumizeVideoFile): string =>
	file.streamLink || file.link;
