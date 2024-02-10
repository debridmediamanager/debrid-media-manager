import { getMagnetStatus } from '@/services/allDebrid';
import { getUserTorrentsList } from '@/services/realDebrid';
import { UserTorrent } from '@/torrent/userTorrent';
import { filenameParse } from '@ctrl/video-filename-parser';
import toast from 'react-hot-toast';
import { getMediaId } from './mediaId';
import { getTypeByFilenames, getTypeByNameAndFileCount } from './mediaType';
import getReleaseTags from './score';
import { genericToastOptions } from './toastOptions';

const ONE_GIGABYTE = 1024 * 1024 * 1024;

export const fetchRealDebrid = async (
	rdKey: string,
	callback: (torrents: UserTorrent[]) => Promise<void>,
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
					...torrent,
					score: getReleaseTags(torrent.filename, torrent.bytes / ONE_GIGABYTE).score,
					info,
					mediaType,
					added: new Date(torrent.added.replace('Z', '+01:00')),
					id: `rd:${torrent.id}`,
					links: torrent.links.map((l) => l.replaceAll('/', '/')),
					seeders: torrent.seeders || 0,
					speed: torrent.speed || 0,
					title: getMediaId(info, mediaType, false) || torrent.filename,
					cached: true,
				};
			}) as UserTorrent[];
			await callback(torrents);
		}
	} catch (error) {
		await callback([]);
		toast.error('Error fetching Real-Debrid torrents list', genericToastOptions);
		console.error(error);
	}
};

export const fetchAllDebrid = async (
	adKey: string,
	callback: (torrents: UserTorrent[]) => Promise<void>
) => {
	try {
		const torrents = (await getMagnetStatus(adKey)).data.magnets.map((torrent) => {
			if (torrent.filename === torrent.hash) {
				torrent.filename = 'Magnet';
			}
			const mediaType = getTypeByFilenames(
				torrent.filename,
				torrent.links.map((l) => l.filename)
			);
			const info =
				mediaType === 'movie'
					? filenameParse(torrent.filename)
					: filenameParse(torrent.filename, true);

			const date = new Date(torrent.uploadDate * 1000);
			// Format date string

			let status = 'error';
			if (torrent.statusCode >= 0 && torrent.statusCode <= 3) {
				status = 'downloading';
			} else if (torrent.statusCode === 4) {
				status = 'downloaded';
			}

			if (torrent.size === 0) torrent.size = 1;

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
					torrent.statusCode === 4
						? 100
						: ((torrent.downloaded ?? 0) / (torrent.size ?? 1)) * 100,
				status,
				added: date,
				speed: torrent.downloadSpeed || 0,
				links: torrent.links.map((l) => l.link),
				adData: torrent,
			};
		}) as UserTorrent[];
		await callback(torrents);
	} catch (error) {
		await callback([]);
		toast.error('Error fetching AllDebrid torrents list', genericToastOptions);
		console.error(error);
	}
};
