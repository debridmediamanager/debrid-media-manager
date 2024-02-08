import {
	addHashAsMagnet,
	deleteTorrent,
	getTorrentInfo,
	unrestrictLink,
} from '@/services/realDebrid';
import { handleSelectFilesInRd } from './addMagnet';

export const getStreamUrl = async (
	rdKey: string,
	hash: string,
	fileId: string,
	ipAddress: string
) => {
	let streamUrl = '';
	try {
		const id = await addHashAsMagnet(rdKey, hash, true);
		try {
			await handleSelectFilesInRd(rdKey, `rd:${id}`, true);
			const torrent = await getTorrentInfo(rdKey, id, true);
			let link = '';

			if (!fileId) {
				// get biggest file index
				const biggestFile = torrent.files.reduce((prev, current) => {
					return prev.bytes > current.bytes ? prev : current;
				});
				const biggestFileIdx = torrent.files.findIndex((f) => f.id === biggestFile.id);
				link = torrent.links[biggestFileIdx] ?? torrent.links[0];
			} else {
				const intFileId = parseInt(fileId);
				const fileIdx = torrent.files
					.filter((f) => f.selected)
					.findIndex((f) => f.id === intFileId);
				link = torrent.links[fileIdx] ?? torrent.links[0];
			}

			const resp = await unrestrictLink(rdKey, link, ipAddress, true);
			streamUrl = resp.download;
			await deleteTorrent(rdKey, id, true);
		} catch (e) {
			await deleteTorrent(rdKey, id, true);
		}
	} catch (e) {
		console.log(e);
	}
	return streamUrl;
};
