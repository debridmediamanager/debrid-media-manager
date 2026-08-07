import { createShortUrl } from '@/services/hashlists';
import { UserTorrent } from '@/torrent/userTorrent';
import lzString from 'lz-string';
import toast from 'react-hot-toast';
import { libraryToastOptions } from './toastOptions';
import { isWebDownloadRowId } from './torboxWebDownload';

// A hash list is a list of infohashes anyone can re-add. A TorBox web download
// has an md5 of its source link instead, which nobody can add anywhere, so it
// is left out rather than shared as a hash that resolves to nothing.
export const shareableTorrents = (list: UserTorrent[]) =>
	list.filter((t) => !isWebDownloadRowId(t.id));

export async function generateHashList(title: string, filteredList: UserTorrent[]) {
	const shareable = shareableTorrents(filteredList);
	const skipped = filteredList.length - shareable.length;
	if (skipped > 0) {
		toast(
			`Skipping ${skipped} web download${skipped === 1 ? '' : 's'} — they cannot be shared as hashes.`,
			libraryToastOptions
		);
	}
	// Only bail when web downloads were all there was; an empty list still
	// produces an (empty) hash list, as it always has
	if (shareable.length === 0 && skipped > 0) {
		toast.error('Nothing to share — that list is only web downloads.', libraryToastOptions);
		return;
	}

	toast('Hash list may 404 for 1-2 minutes—refresh if needed.', {
		...libraryToastOptions,
		duration: 60000,
	});
	try {
		const torrents = shareable.map((t) => ({
			filename: t.filename,
			hash: t.hash,
			bytes: t.bytes,
		}));
		const hashlist = {
			title,
			torrents,
		};
		const shortUrl = await createShortUrl(
			`${window.location.protocol}//${
				window.location.host
			}/hashlist#${lzString.compressToEncodedURIComponent(JSON.stringify(hashlist))}`
		);
		window.open(shortUrl);
	} catch (error) {
		toast.error('Failed to generate hash list; try again soon.', libraryToastOptions);
		console.error(error);
	}
}

export async function handleShare(
	t: Pick<UserTorrent, 'filename' | 'hash' | 'bytes'>
): Promise<string> {
	const hashList = [
		{
			filename: t.filename,
			hash: t.hash,
			bytes: t.bytes,
		},
	];
	return `/hashlist#${lzString.compressToEncodedURIComponent(JSON.stringify(hashList))}`;
}
