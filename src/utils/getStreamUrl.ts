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
	fileId: number,
	ipAddress: string
): Promise<[string, number, number]> => {
	let streamUrl = '';
	let seasonNumber = -1;
	let episodeNumber = -1;
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
				const fileIdx = torrent.files
					.filter((f) => f.selected)
					.findIndex((f) => f.id === fileId);
				link = torrent.links[fileIdx] ?? torrent.links[0];
				const filePath = torrent.files[fileIdx].path;
				let epRegex = /S(\d+)\s?E(\d+)/i;
				seasonNumber = filePath.match(epRegex)?.length
					? parseInt(filePath.match(epRegex)![1], 10)
					: -1;
				episodeNumber = filePath.match(epRegex)?.length
					? parseInt(filePath.match(epRegex)![2], 10)
					: -1;
				if (seasonNumber === -1 || episodeNumber === -1) {
					epRegex = /(\d+)x(\d+)/i;
					seasonNumber = filePath.match(epRegex)?.length
						? parseInt(filePath.match(epRegex)![1], 10)
						: -1;
					episodeNumber = filePath.match(epRegex)?.length
						? parseInt(filePath.match(epRegex)![2], 10)
						: -1;
				}
			}

			const resp = await unrestrictLink(rdKey, link, ipAddress, true);
			streamUrl = resp.download;
			await deleteTorrent(rdKey, id, true);
		} catch (e) {
			console.log('error after adding hash', e);
			await deleteTorrent(rdKey, id, true);
		}
	} catch (e) {
		console.log('error on adding hash', e);
	}
	return [streamUrl, seasonNumber, episodeNumber];
};
