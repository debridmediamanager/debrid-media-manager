import { createShortUrl } from '@/services/hashlists';
import { UserTorrent } from '@/torrent/userTorrent';
import lzString from 'lz-string';
import toast from 'react-hot-toast';
import { libraryToastOptions } from './toastOptions';
import { isWebDownloadRowId } from './torboxWebDownload';

// A hash list is a list of infohashes anyone can re-add. Three kinds of row have
// no infohash to share: a TorBox web download carries an md5 of its source link;
// a Premiumize row carries nothing at all unless its transfer is still live
// (`transfer/list` does not report a hash, and `job/src` only answers for a
// transfer that still exists); and an Offcloud row created from a plain HTTP URL
// - it is a remote-download service as well as a torrent one - never had one.
// All are left out rather than shared as a hash that resolves to nothing - and
// an empty hash would otherwise collapse every such row into one "same hash"
// group.
export const shareableTorrents = (list: UserTorrent[]) =>
	list.filter((t) => !isWebDownloadRowId(t.id) && !!t.hash);

export async function generateHashList(title: string, filteredList: UserTorrent[]) {
	const shareable = shareableTorrents(filteredList);
	const skipped = filteredList.length - shareable.length;
	if (skipped > 0) {
		toast(
			`Skipping ${skipped} item${skipped === 1 ? '' : 's'} with no info hash — they cannot be shared.`,
			libraryToastOptions
		);
	}
	// Only bail when hash-less rows were all there was; an empty list still
	// produces an (empty) hash list, as it always has
	if (shareable.length === 0 && skipped > 0) {
		toast.error('Nothing to share — none of those have an info hash.', libraryToastOptions);
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
