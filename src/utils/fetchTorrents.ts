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
			const torrents = pageOfTorrents.map((torrentInfo) => {
				const mediaType = getTypeByNameAndFileCount(torrentInfo.filename, torrentInfo.links.length);
				const info =
					mediaType === 'movie'
						? filenameParse(torrentInfo.filename)
						: filenameParse(torrentInfo.filename, true);
				return {
					...torrentInfo,
					score: getReleaseTags(torrentInfo.filename, torrentInfo.bytes / ONE_GIGABYTE).score,
					info,
					mediaType,
					added: new Date(torrentInfo.added.replace('Z', '+01:00')),
					id: `rd:${torrentInfo.id}`,
					links: torrentInfo.links.map((l) => l.replaceAll('/', '/')),
					seeders: torrentInfo.seeders || 0,
					speed: torrentInfo.speed || 0,
					title: getMediaId(info, mediaType, false) || torrentInfo.filename,
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
		const magnets = (await getMagnetStatus(adKey)).data.magnets.map((magnetInfo) => {
			if (magnetInfo.filename === magnetInfo.hash) {
				magnetInfo.filename = 'Magnet';
			}
			const mediaType = getTypeByFilenames(
				magnetInfo.filename,
				magnetInfo.links.map((l) => l.filename)
			);
			const info =
				mediaType === 'movie'
					? filenameParse(magnetInfo.filename)
					: filenameParse(magnetInfo.filename, true);

			const date = new Date(magnetInfo.uploadDate * 1000);
			// Format date string

			let status = 'error';
			if (magnetInfo.statusCode >= 0 && magnetInfo.statusCode <= 3) {
				status = 'downloading';
			} else if (magnetInfo.statusCode === 4) {
				status = 'downloaded';
			}

			if (magnetInfo.size === 0) magnetInfo.size = 1;

			return {
				score: getReleaseTags(magnetInfo.filename, magnetInfo.size / ONE_GIGABYTE).score,
				info,
				mediaType,
				title: getMediaId(info, mediaType, false) || magnetInfo.filename,
				id: `ad:${magnetInfo.id}`,
				filename: magnetInfo.filename,
				hash: magnetInfo.hash,
				bytes: magnetInfo.size,
				progress:
					magnetInfo.statusCode === 4
						? 100
						: ((magnetInfo.downloaded ?? 0) / (magnetInfo.size ?? 1)) * 100,
				status,
				added: date,
				speed: magnetInfo.downloadSpeed || 0,
				links: magnetInfo.links.map((l) => l.link),
				adData: magnetInfo,
			};
		}) as UserTorrent[];
		await callback(magnets);
	} catch (error) {
		await callback([]);
		toast.error('Error fetching AllDebrid torrents list', genericToastOptions);
		console.error(error);
	}
};
