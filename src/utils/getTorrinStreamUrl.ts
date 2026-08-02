import {
	addTorrinMagnet,
	deleteTorrinTorrent,
	findTorrinTorrentByHash,
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

	const existing = await findTorrinTorrentByHash(baseUrl, apiKey, hash);
	let addedThisCall = false;
	let id: string;
	if (existing) {
		id = existing.id;
	} else {
		addedThisCall = true;
		id = await addTorrinMagnet(baseUrl, apiKey, hash);
	}
	try {
		// Only (re)select files for a torrent we just added; never overwrite an
		// existing library torrent's selection state.
		if (addedThisCall) await selectTorrinFiles(baseUrl, apiKey, id, 'all');
		const torrentInfo = await getTorrinTorrentInfo(baseUrl, apiKey, id);

		const selectedFiles = torrentInfo.files.filter((f) => f.selected);
		const fileIdx = selectedFiles.findIndex((f) => f.id === fileId);
		if (fileIdx < 0) {
			throw new Error(`requested file ${fileId} is not selected in torrent ${id}`);
		}
		const link = torrentInfo.links[fileIdx];

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

		fileSize = Math.round((selectedFiles[fileIdx]?.bytes ?? 0) / 1024 / 1024);

		if (addedThisCall) await deleteTorrinTorrent(baseUrl, apiKey, id);
	} catch (e) {
		console.error('error after adding hash', e);
		if (addedThisCall) await deleteTorrinTorrent(baseUrl, apiKey, id).catch(() => undefined);
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

	const existing = await findTorrinTorrentByHash(baseUrl, apiKey, hash);
	let addedThisCall = false;
	let id: string;
	if (existing) {
		id = existing.id;
	} else {
		addedThisCall = true;
		id = await addTorrinMagnet(baseUrl, apiKey, hash);
	}
	try {
		if (addedThisCall) await selectTorrinFiles(baseUrl, apiKey, id, 'all');
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
		fileSize = Math.round(biggestFile.bytes / 1024 / 1024);

		if (addedThisCall) await deleteTorrinTorrent(baseUrl, apiKey, id);
	} catch (e) {
		console.error('error after adding hash', e);
		if (addedThisCall) await deleteTorrinTorrent(baseUrl, apiKey, id).catch(() => undefined);
		throw e;
	}

	return [streamUrl, trLink, fileSize];
};
