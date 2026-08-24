import {
	addHashAsMagnet,
	deleteTorrent,
	getTorrentInfo,
	unrestrictLink,
} from '@/services/realDebrid';
import ptt from 'parse-torrent-title';
import { handleSelectFilesInRd } from './addMagnet';

// `torrentInfo.links` covers the *selected* files only, one link per selected
// file in the same order, while `torrentInfo.files` lists every file in the
// torrent. Indexing `links` with a position from `files` therefore silently
// hands back a different file's link whenever anything went unselected — and
// `handleSelectFilesInRd` deselects every non-video file, so that is the normal
// case. Both callers below go through here so the pairing is done once.
const pickLink = (
	torrentInfo: { files: { id: number; bytes: number; selected: number }[]; links: string[] },
	choose: (selected: { id: number; bytes: number; selected: number }[]) => number
): string => {
	const selected = torrentInfo.files.filter((f) => f.selected);
	if (selected.length === 0) {
		throw new Error('no_selected_files');
	}
	// RD returns exactly one link per selected file. When it does not, the two
	// arrays cannot be paired at all, and guessing casts the wrong file.
	if (selected.length !== torrentInfo.links.length) {
		throw new Error(
			`link count mismatch: ${selected.length} selected files, ${torrentInfo.links.length} links`
		);
	}
	const idx = choose(selected);
	if (idx < 0) {
		throw new Error('file_not_selected');
	}
	return torrentInfo.links[idx];
};

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
		const id = await addHashAsMagnet(rdKey, hash, false);
		try {
			await handleSelectFilesInRd(rdKey, `rd:${id}`, false);
			const torrentInfo = await getTorrentInfo(rdKey, id, false);

			const link = pickLink(torrentInfo, (selected) =>
				selected.findIndex((f) => f.id === fileId)
			);

			const resp = await unrestrictLink(rdKey, link, ipAddress, false);
			if (!resp.streamable) {
				throw new Error('not streamable');
			}

			streamUrl = resp.download;
			rdLink = resp.link;

			// Anything that is not a movie is episodic and needs its season and
			// episode parsed, or the cast key collapses onto the bare title id.
			// This used to test `=== 'tv'`, so the anime route - which passes
			// 'anime' - never parsed anything and wrote every episode of a batch
			// to the same key, one overwriting the next.
			if (mediaType !== 'movie') {
				const info = ptt.parse(resp.filename.split('/').pop() || '');
				seasonNumber = info.season ?? -1;
				episodeNumber = info.episode ?? -1;
			}

			fileSize = Math.round(resp.filesize / 1024 / 1024);

			await deleteTorrent(rdKey, id, false);
		} catch (e) {
			console.error('error after adding hash', e);
			await deleteTorrent(rdKey, id, false);
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
		const id = await addHashAsMagnet(rdKey, hash, false);
		try {
			await handleSelectFilesInRd(rdKey, `rd:${id}`, false);
			const torrent = await getTorrentInfo(rdKey, id, false);

			const link = pickLink(torrent, (selected) => {
				const biggest = selected.reduce((prev, current) =>
					prev.bytes > current.bytes ? prev : current
				);
				return selected.findIndex((f) => f.id === biggest.id);
			});

			const resp = await unrestrictLink(rdKey, link, ipAddress, false);
			if (!resp.streamable) {
				throw new Error('not streamable');
			}

			streamUrl = resp.download;
			rdLink = resp.link;

			fileSize = Math.round(resp.filesize / 1024 / 1024);

			await deleteTorrent(rdKey, id, false);
		} catch (e) {
			console.error('error after adding hash', e);
			await deleteTorrent(rdKey, id, false);
			throw e;
		}
	} catch (e) {
		throw e;
	}
	return [streamUrl, rdLink, fileSize];
};
