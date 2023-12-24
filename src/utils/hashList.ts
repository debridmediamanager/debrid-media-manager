import { createShortUrl } from '@/services/hashlists';
import { UserTorrent } from '@/torrent/userTorrent';
import lzString from 'lz-string';
import toast from 'react-hot-toast';
import { libraryToastOptions } from './toastOptions';

export async function generateHashList(filteredList: UserTorrent[]) {
	toast('The hash list will return a 404 for the first 1-2 minutes', {
		...libraryToastOptions,
		duration: 60000,
	});
	try {
		const hashList = filteredList.map((t) => ({
			filename: t.filename,
			hash: t.hash,
			bytes: t.bytes,
		}));
		const shortUrl = await createShortUrl(
			`${window.location.protocol}//${
				window.location.host
			}/hashlist#${lzString.compressToEncodedURIComponent(JSON.stringify(hashList))}`
		);
		window.open(shortUrl);
	} catch (error) {
		toast.error(`Error generating hash list, try again later`, libraryToastOptions);
		console.error(error);
	}
}

export async function handleShare(t: UserTorrent): Promise<string> {
	const hashList = [
		{
			filename: t.filename,
			hash: t.hash,
			bytes: t.bytes,
		},
	];
	return `/hashlist#${lzString.compressToEncodedURIComponent(JSON.stringify(hashList))}`;
}
