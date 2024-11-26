import {
	addHashAsMagnet,
	deleteTorrent,
	getTorrentInfo,
	unrestrictLink,
} from '@/services/realDebrid';
import ptt from 'parse-torrent-title';
import { handleSelectFilesInRd } from './addMagnet';

export const getStreamUrl = async (
	rdKey: string,
	hash: string,
	fileId: number,
	ipAddress: string,
	mediaType: string
): Promise<[string, string, number, number, number]> => {
	let streamUrl = '';
	let rdLink = '';
	let seasonNumber = -1;
	let episodeNumber = -1;
	let fileSize = 0;
	try {
		const id = await addHashAsMagnet(rdKey, hash, true);
		try {
			await handleSelectFilesInRd(rdKey, `rd:${id}`, true);
			const torrentInfo = await getTorrentInfo(rdKey, id, true);
			let link = '';

			const fileIdx = torrentInfo.files
				.filter((f) => f.selected)
				.findIndex((f) => f.id === fileId);
			link = torrentInfo.links[fileIdx] ?? torrentInfo.links[0];

			const resp = await unrestrictLink(rdKey, link, ipAddress, true);
			if (!resp.streamable) {
				throw new Error('not streamable');
			}

			streamUrl = resp.download;
			rdLink = resp.link;

			if (mediaType === 'tv') {
				const info = ptt.parse(resp.filename.split('/').pop() || '');
				seasonNumber = info.season || -1;
				episodeNumber = info.episode || -1;
			}

			fileSize = Math.round(resp.filesize / 1024 / 1024);

			await deleteTorrent(rdKey, id, true);
		} catch (e) {
			console.log('error after adding hash', e);
			await deleteTorrent(rdKey, id, true);
			throw e;
		}
	} catch (e) {
		throw e;
	}
	return [streamUrl, rdLink, seasonNumber, episodeNumber, fileSize];
};

export const getBiggestFileStreamUrl = async (
	rdKey: string,
	hash: string,
	ipAddress: string
): Promise<[string, string, number]> => {
	let streamUrl = '';
	let rdLink = '';
	let fileSize = 0;
	try {
		const id = await addHashAsMagnet(rdKey, hash, true);
		try {
			await handleSelectFilesInRd(rdKey, `rd:${id}`, true);
			const torrent = await getTorrentInfo(rdKey, id, true);
			let link = '';

			const biggestFile = torrent.files.reduce((prev, current) => {
				return prev.bytes > current.bytes ? prev : current;
			});
			const biggestFileIdx = torrent.files.findIndex((f) => f.id === biggestFile.id);
			link = torrent.links[biggestFileIdx] ?? torrent.links[0];

			const resp = await unrestrictLink(rdKey, link, ipAddress, true);
			if (!resp.streamable) {
				throw new Error('not streamable');
			}

			streamUrl = resp.download;
			rdLink = resp.link;

			fileSize = Math.round(resp.filesize / 1024 / 1024);

			await deleteTorrent(rdKey, id, true);
		} catch (e) {
			console.log('error after adding hash', e);
			await deleteTorrent(rdKey, id, true);
			throw e;
		}
	} catch (e) {
		throw e;
	}
	return [streamUrl, rdLink, fileSize];
};
