import {
	addTorrinMagnet,
	deleteTorrinTorrent,
	getTorrinTorrentInfo,
	selectTorrinFiles,
	unrestrictTorrinLink,
} from '@/services/torrin';
import ptt from 'parse-torrent-title';

export const getTorrinStreamUrl = async (
	baseUrl: string,
	apiKey: string,
	hash: string,
	fileId: number,
	mediaType: string
): Promise<[string, string, number, number, number]> => {
	let streamUrl = '';
	let trLink = '';
	let seasonNumber = -1;
	let episodeNumber = -1;
	let fileSize = 0;

	const id = await addTorrinMagnet(baseUrl, apiKey, hash);
	try {
		await selectTorrinFiles(baseUrl, apiKey, id, 'all');
		const torrentInfo = await getTorrinTorrentInfo(baseUrl, apiKey, id);

		const fileIdx = torrentInfo.files.findIndex((f) => f.id === fileId);
		const link = torrentInfo.links[fileIdx] ?? torrentInfo.links[0];

		const resp = await unrestrictTorrinLink(baseUrl, apiKey, link);
		if (!resp.streamable) {
			throw new Error('not streamable');
		}

		streamUrl = resp.download;
		trLink = resp.link;

		if (mediaType === 'tv') {
			const info = ptt.parse(resp.filename.split('/').pop() || '');
			seasonNumber = info.season ?? -1;
			episodeNumber = info.episode ?? -1;
		}

		fileSize = Math.round(resp.filesize / 1024 / 1024);

		await deleteTorrinTorrent(baseUrl, apiKey, id);
	} catch (e) {
		console.error('error after adding hash', e);
		await deleteTorrinTorrent(baseUrl, apiKey, id);
		throw e;
	}

	return [streamUrl, trLink, seasonNumber, episodeNumber, fileSize];
};

export const getBiggestFileTorrinStreamUrl = async (
	baseUrl: string,
	apiKey: string,
	hash: string
): Promise<[string, string, number]> => {
	let streamUrl = '';
	let trLink = '';
	let fileSize = 0;

	const id = await addTorrinMagnet(baseUrl, apiKey, hash);
	try {
		await selectTorrinFiles(baseUrl, apiKey, id, 'all');
		const torrent = await getTorrinTorrentInfo(baseUrl, apiKey, id);

		if (!torrent.files || torrent.files.length === 0) {
			throw new Error('no files');
		}
		const biggestFile = torrent.files.reduce((prev, current) =>
			prev.bytes > current.bytes ? prev : current
		);
		const biggestFileIdx = torrent.files.findIndex((f) => f.id === biggestFile.id);
		const link = torrent.links[biggestFileIdx] ?? torrent.links[0];

		const resp = await unrestrictTorrinLink(baseUrl, apiKey, link);
		if (!resp.streamable) {
			throw new Error('not streamable');
		}

		streamUrl = resp.download;
		trLink = resp.link;
		fileSize = Math.round(resp.filesize / 1024 / 1024);

		await deleteTorrinTorrent(baseUrl, apiKey, id);
	} catch (e) {
		console.error('error after adding hash', e);
		await deleteTorrinTorrent(baseUrl, apiKey, id);
		throw e;
	}

	return [streamUrl, trLink, fileSize];
};
