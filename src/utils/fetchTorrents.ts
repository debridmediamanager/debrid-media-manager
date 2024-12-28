import { MagnetStatus, getMagnetStatus } from '@/services/allDebrid';
import { getUserTorrentsList } from '@/services/realDebrid';
import { TorBoxTorrentInfo, UserTorrentResponse } from '@/services/types';
import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { ParsedFilename, filenameParse } from '@ctrl/video-filename-parser';
import { every, some } from 'lodash';
import toast from 'react-hot-toast';
import { runConcurrentFunctions } from './batch';
import { getMediaId } from './mediaId';
import { getTypeByNameAndFileCount } from './mediaType';
import { checkArithmeticSequenceInFilenames, isVideo } from './selectable';
import { genericToastOptions } from './toastOptions';

export const fetchRealDebrid = async (
	rdKey: string,
	callback: (torrents: UserTorrent[]) => Promise<void>,
	customLimit?: number
) => {
	try {
		// Step 1: Initial request to get the first item and total count of items
		const { data: initialData, totalCount } = await getUserTorrentsList(
			rdKey,
			customLimit ?? 1,
			1
		);

		if (!initialData.length) {
			await callback([]);
			return;
		}

		// Step 2: If limit input is set, convert and call callback
		if (customLimit && customLimit <= 2) {
			const torrents = await processTorrents(initialData);
			await callback(torrents);
			return;
		}

		// Step 3: Send requests in parallel to fetch the other items. Limit count should be 1000
		const limit = 1000;
		const maxPages = Math.ceil((totalCount ?? 1) / limit);
		const funcs = [];

		for (let page = 1; page <= maxPages; page++) {
			funcs.push(() => getUserTorrentsList(rdKey, limit, page));
		}

		// Adjust concurrent requests to stay within rate limit
		// 75 requests per minute = 1.25 requests per second
		// Using 1 request per second to be safe
		const [pagesOfTorrents, errors] = await runConcurrentFunctions(funcs, 3, 0);
		if (errors.length > 0) {
			console.error('Some requests failed:', errors);
		}

		const allData = pagesOfTorrents.flatMap((pageResult) => pageResult.data);

		const torrents = await processTorrents(allData);
		await callback(torrents);
	} catch (error) {
		await callback([]);
		toast.error('Error fetching Real-Debrid torrents list', genericToastOptions);
		console.error(error);
	}
};

export function convertToUserTorrent(torrentInfo: UserTorrentResponse): UserTorrent {
	let mediaType = getTypeByNameAndFileCount(torrentInfo.filename);
	const serviceStatus = torrentInfo.status;
	const status = getRdStatus(torrentInfo);

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
		selectedFiles: [],
	};
}

async function processTorrents(torrentData: UserTorrentResponse[]): Promise<UserTorrent[]> {
	return Promise.all(torrentData.map(convertToUserTorrent));
}

export const fetchAllDebrid = async (
	adKey: string,
	callback: (torrents: UserTorrent[]) => Promise<void>
) => {
	try {
		const magnets = (await getMagnetStatus(adKey)).data.magnets.map((magnetInfo) => {
			if (magnetInfo.filename === magnetInfo.hash) {
				magnetInfo.filename = 'Magnet';
			}
			let mediaType = 'other';
			let info = undefined;

			const filenames = magnetInfo.links.map((f) => f.filename);
			const torrentAndFiles = [magnetInfo.filename, ...filenames];
			const hasEpisodes = checkArithmeticSequenceInFilenames(filenames);

			if (every(torrentAndFiles, (f) => !isVideo({ path: f }))) {
				mediaType = 'other';
				info = undefined;
			} else if (
				hasEpisodes ||
				some(torrentAndFiles, (f) => /s\d\d\d?.?e\d\d\d?/i.test(f)) ||
				some(torrentAndFiles, (f) => /season.?\d+/i.test(f)) ||
				some(torrentAndFiles, (f) => /episodes?\s?\d+/i.test(f)) ||
				some(torrentAndFiles, (f) => /\b[a-fA-F0-9]{8}\b/.test(f))
			) {
				mediaType = 'tv';
				info = filenameParse(magnetInfo.filename, true);
			} else if (
				!hasEpisodes &&
				every(torrentAndFiles, (f) => !/s\d\d\d?.?e\d\d\d?/i.test(f)) &&
				every(torrentAndFiles, (f) => !/season.?\d+/i.test(f)) &&
				every(torrentAndFiles, (f) => !/episodes?\s?\d+/i.test(f)) &&
				every(torrentAndFiles, (f) => !/\b[a-fA-F0-9]{8}\b/.test(f))
			) {
				mediaType = 'movie';
				info = filenameParse(magnetInfo.filename);
			}

			const date = new Date(magnetInfo.uploadDate * 1000);

			const serviceStatus = `${magnetInfo.statusCode}`;
			const [status, progress] = getAdStatus(magnetInfo);
			if (magnetInfo.size === 0) magnetInfo.size = 1;
			let idx = 0;
			return {
				// score: getReleaseTags(magnetInfo.filename, magnetInfo.size / ONE_GIGABYTE).score,
				info,
				mediaType,
				title:
					info && (mediaType === 'movie' || mediaType == 'tv')
						? getMediaId(info, mediaType, false)
						: magnetInfo.filename,
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

export const convertToTbUserTorrent = (info: TorBoxTorrentInfo): UserTorrent => {
	let mediaType = getTypeByNameAndFileCount(info.name);
	const serviceStatus = info.download_state;
	let status: UserTorrentStatus;

	// Map TorBox status to UserTorrentStatus
	switch (info.download_state.toLowerCase()) {
		case 'queued':
		case 'checking':
			status = UserTorrentStatus.waiting;
			break;
		case 'downloading':
		case 'uploading':
			status = UserTorrentStatus.downloading;
			break;
		case 'finished':
		case 'seeding':
			status = UserTorrentStatus.finished;
			break;
		default:
			status = UserTorrentStatus.error;
			break;
	}

	// Parse filename for media info
	let parsedInfo = {} as ParsedFilename;
	try {
		parsedInfo =
			mediaType === 'movie' ? filenameParse(info.name) : filenameParse(info.name, true);
	} catch (error) {
		// flip the condition if error is thrown
		mediaType = mediaType === 'movie' ? 'tv' : 'movie';
		try {
			parsedInfo =
				mediaType === 'movie' ? filenameParse(info.name) : filenameParse(info.name, true);
		} catch {
			// If both parsing attempts fail, leave parsedInfo empty
		}
	}

	// Convert TorBoxFile[] to SelectedFile[]
	const selectedFiles =
		info.files?.map((file, index) => ({
			fileId: index,
			filename: file.name,
			filesize: file.size,
			link: file.s3_path,
		})) ?? [];

	return {
		id: `tb:${info.id}`,
		links: selectedFiles.map((f) => f.link),
		seeders: info.seeds,
		speed: info.download_speed,
		title:
			parsedInfo && (mediaType === 'movie' || mediaType === 'tv')
				? getMediaId(parsedInfo, mediaType, false) || info.name
				: info.name,
		selectedFiles,
		filename: info.name,
		bytes: info.size,
		status,
		serviceStatus,
		progress: info.progress,
		added: new Date(info.created_at),
		hash: info.hash,
		mediaType,
		info: Object.keys(parsedInfo).length > 0 ? parsedInfo : undefined,
		tbData: info,
	};
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
