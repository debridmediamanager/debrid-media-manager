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
	ipAddress: string,
	mediaType: string
): Promise<[string, number, number, number]> => {
	let streamUrl = '';
	let seasonNumber = -1;
	let episodeNumber = -1;
	let fileSize = 0;
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
			}

			const resp = await unrestrictLink(rdKey, link, ipAddress, true);
			streamUrl = resp.download;

			if (mediaType === 'tv') {
				const filePath = streamUrl.split('/').pop() ?? '';
				let epRegex = /S(\d+)\s?E(\d+)/i;
				seasonNumber = filePath.match(epRegex)?.length
					? parseInt(filePath.match(epRegex)![1], 10)
					: -1;
				episodeNumber = filePath.match(epRegex)?.length
					? parseInt(filePath.match(epRegex)![2], 10)
					: -1;
				if (seasonNumber === -1 || episodeNumber === -1) {
					epRegex = /[^\d](\d{1,2})x(\d{1,2})[^\d]/i;
					seasonNumber = filePath.match(epRegex)?.length
						? parseInt(filePath.match(epRegex)![1], 10)
						: -1;
					episodeNumber = filePath.match(epRegex)?.length
						? parseInt(filePath.match(epRegex)![2], 10)
						: -1;
				}
			}

			fileSize = Math.round(resp.filesize / 1024 / 1024);

			await deleteTorrent(rdKey, id, true);
		} catch (e) {
			console.log('error after adding hash', e);
			await deleteTorrent(rdKey, id, true);
		}
	} catch (e) {
		console.log('error on adding hash', (e as any).message);
	}
	return [streamUrl, seasonNumber, episodeNumber, fileSize];
};
