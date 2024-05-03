import { MagnetStatus, getMagnetStatus } from '@/services/allDebrid';
import { UserTorrentResponse, getUserTorrentsList } from '@/services/realDebrid';
import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { ParsedFilename, filenameParse } from '@ctrl/video-filename-parser';
import toast from 'react-hot-toast';
import { getMediaId } from './mediaId';
import { getTypeByFilenames, getTypeByNameAndFileCount } from './mediaType';
import { genericToastOptions } from './toastOptions';

export const fetchRealDebrid = async (
	rdKey: string,
	callback: (torrents: UserTorrent[]) => Promise<void>,
	customLimit?: number
) => {
	try {
		for await (let pageOfTorrents of getUserTorrentsList(rdKey, customLimit)) {
			const torrents = pageOfTorrents.map((torrentInfo) => {
				let mediaType = getTypeByNameAndFileCount(
					torrentInfo.filename,
					torrentInfo.links.length
				);
				const serviceStatus = torrentInfo.status;
				let status: UserTorrentStatus;
				switch (torrentInfo.status) {
					case 'magnet_conversion':
					case 'waiting_files_selection':
					case 'queued':
						status = UserTorrentStatus.waiting;
						break;
					case 'downloading':
					case 'compressing':
						status = UserTorrentStatus.downloading;
						break;
					case 'uploading':
					case 'downloaded':
						status = UserTorrentStatus.finished;
						break;
					default:
						status = UserTorrentStatus.error;
						break;
				}
				let info = {} as ParsedFilename;
				try {
					info =
						mediaType === 'movie'
							? filenameParse(torrentInfo.filename)
							: filenameParse(torrentInfo.filename, true);
				} catch (error) {
					// flip the condition if error is thrown
					mediaType = mediaType === 'movie' ? 'tv' : 'movie';
					mediaType === 'movie'
						? filenameParse(torrentInfo.filename)
						: filenameParse(torrentInfo.filename, true);
				}
				return {
					...torrentInfo,
					// score: getReleaseTags(torrentInfo.filename, torrentInfo.bytes / ONE_GIGABYTE).score,
					info,
					status,
					serviceStatus,
					mediaType,
					added: new Date(torrentInfo.added.replace('Z', '+01:00')),
					id: `rd:${torrentInfo.id}`,
					links: torrentInfo.links.map((l) => l.replaceAll('/', '/')),
					seeders: torrentInfo.seeders || 0,
					speed: torrentInfo.speed || 0,
					title: getMediaId(info, mediaType, false) || torrentInfo.filename,
					cached: true,
					selectedFiles: [],
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

			const serviceStatus = `${magnetInfo.statusCode}`;
			const [status, progress] = getAdStatus(magnetInfo);
			if (magnetInfo.size === 0) magnetInfo.size = 1;
			let idx = 0;
			return {
				// score: getReleaseTags(magnetInfo.filename, magnetInfo.size / ONE_GIGABYTE).score,
				info,
				mediaType,
				title: getMediaId(info, mediaType, false) || magnetInfo.filename,
				id: `ad:${magnetInfo.id}`,
				filename: magnetInfo.filename,
				hash: magnetInfo.hash,
				bytes: magnetInfo.size,
				seeders: magnetInfo.seeders,
				progress,
				status,
				serviceStatus,
				added: date,
				speed: magnetInfo.downloadSpeed || 0,
				links: magnetInfo.links.map((l) => l.link),
				adData: magnetInfo,
				selectedFiles: magnetInfo.links.map((l) => ({
					fileId: idx++,
					filename: l.filename,
					filesize: l.size,
					link: l.link,
				})),
			};
		}) as UserTorrent[];
		await callback(magnets);
	} catch (error) {
		await callback([]);
		toast.error('Error fetching AllDebrid torrents list', genericToastOptions);
		console.error(error);
	}
};

export const getRdStatus = (torrentInfo: UserTorrentResponse): UserTorrentStatus => {
	let status: UserTorrentStatus;
	switch (torrentInfo.status) {
		case 'magnet_conversion':
		case 'waiting_files_selection':
		case 'queued':
			status = UserTorrentStatus.waiting;
			break;
		case 'downloading':
		case 'compressing':
		case 'uploading':
			status = UserTorrentStatus.downloading;
			break;
		case 'downloaded':
			status = UserTorrentStatus.finished;
			break;
		default:
			status = UserTorrentStatus.error;
			break;
	}
	return status;
};
export const getAdStatus = (magnetInfo: MagnetStatus) => {
	let status: UserTorrentStatus;
	let progress: number;
	switch (magnetInfo.statusCode) {
		case 0:
			status = UserTorrentStatus.waiting;
			progress = 0;
			break;
		case 1:
		case 2:
		case 3:
			status = UserTorrentStatus.downloading;
			progress = (magnetInfo.downloaded / (magnetInfo.size || 1)) * 100;
			break;
		case 4:
			status = UserTorrentStatus.finished;
			progress = 100;
			break;
		default:
			status = UserTorrentStatus.error;
			progress = 0;
			break;
	}
	return [status, progress];
};
