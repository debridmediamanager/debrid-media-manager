import { getMagnetStatus } from '@/services/allDebrid';
import { getUserTorrentsList } from '@/services/realDebrid';
import { UserTorrent } from '@/torrent/userTorrent';
import { filenameParse } from '@ctrl/video-filename-parser';
import toast from 'react-hot-toast';
import { getMediaId } from './mediaId';
import { getTypeByName, getTypeByNameAndFileCount } from './mediaType';
import getReleaseTags from './score';
import { genericToastOptions } from './toastOptions';

const ONE_GIGABYTE = 1024 * 1024 * 1024;

export const fetchRealDebrid = async (
	rdKey: string,
	callback: (torrents: UserTorrent[]) => void,
	customLimit?: number
) => {
	try {
		for await (let pageOfTorrents of getUserTorrentsList(rdKey, customLimit)) {
			const torrents = pageOfTorrents.map((torrent) => {
				const mediaType = getTypeByNameAndFileCount(torrent.filename, torrent.links.length);
				const info =
					mediaType === 'movie'
						? filenameParse(torrent.filename)
						: filenameParse(torrent.filename, true);
				return {
					score: getReleaseTags(torrent.filename, torrent.bytes / ONE_GIGABYTE).score,
					info,
					mediaType,
					title: getMediaId(info, mediaType, false) || torrent.filename,
					...torrent,
					id: `rd:${torrent.id}`,
					links: torrent.links.map((l) => l.replaceAll('/', '/')),
					seeders: torrent.seeders || 0,
					speed: torrent.speed || 0,
				};
			}) as UserTorrent[]; // Cast the result to UserTorrent[] to ensure type correctness
			callback(torrents);
		}
	} catch (error) {
		callback([]);
		toast.error('Error fetching Real-Debrid torrents list', genericToastOptions);
		console.error(error);
	}
};

export const fetchAllDebrid = async (
	adKey: string,
	callback: (torrents: UserTorrent[]) => void
) => {
	try {
		const torrents = (await getMagnetStatus(adKey)).data.magnets.map((torrent) => {
			const mediaType = getTypeByName(torrent.filename);
			const info =
				mediaType === 'movie'
					? filenameParse(torrent.filename)
					: filenameParse(torrent.filename, true);

			const date = new Date(torrent.uploadDate * 1000);
			// Format date string
			const formattedDate = date.toISOString();

			let status = 'error';
			if (torrent.statusCode >= 0 && torrent.statusCode <= 3) {
				status = 'downloading';
			} else if (torrent.statusCode === 4) {
				status = 'downloaded';
			}

			return {
				score: getReleaseTags(torrent.filename, torrent.size / ONE_GIGABYTE).score,
				info,
				mediaType,
				title: getMediaId(info, mediaType, false) || torrent.filename,
				id: `ad:${torrent.id}`,
				filename: torrent.filename,
				hash: torrent.hash,
				bytes: torrent.size,
				progress:
					torrent.statusCode === 4 ? 100 : (torrent.downloaded / torrent.size) * 100,
				status,
				added: formattedDate,
				speed: torrent.downloadSpeed || 0,
				links: torrent.links.map((l) => l.link),
			};
		}) as UserTorrent[];
		callback(torrents);
	} catch (error) {
		callback([]);
		toast.error('Error fetching AllDebrid torrents list', genericToastOptions);
		console.error(error);
	}
};
