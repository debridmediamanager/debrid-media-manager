import { MagnetStatus, getMagnetStatus } from '@/services/allDebrid';
import { getUserTorrentsList } from '@/services/realDebrid';
import { TorBoxTorrentInfo, UserTorrentResponse } from '@/services/types';
import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { ParsedFilename, filenameParse } from '@ctrl/video-filename-parser';
import { every, some } from 'lodash';
import toast from 'react-hot-toast';
import { getMediaId } from './mediaId';
import { getTypeByNameAndFileCount } from './mediaType';
import { checkArithmeticSequenceInFilenames, isVideo } from './selectable';
import { genericToastOptions } from './toastOptions';

// Custom queue implementation for controlled concurrency
class RequestQueue {
	private queue: (() => Promise<any>)[] = [];
	private running = 0;
	private maxConcurrent: number;
	private results: any[] = [];
	private errors: any[] = [];

	constructor(maxConcurrent: number) {
		this.maxConcurrent = maxConcurrent;
	}

	add(fn: () => Promise<any>) {
		this.queue.push(fn);
		this.tryExecuteNext();
		return this;
	}

	private async tryExecuteNext() {
		if (this.running >= this.maxConcurrent || this.queue.length === 0) {
			return;
		}

		this.running++;
		const task = this.queue.shift()!;

		try {
			const result = await task();
			this.results.push(result);
		} catch (error) {
			this.errors.push(error);
			console.error('Task error:', error);
		} finally {
			this.running--;
			this.tryExecuteNext();
		}
	}

	async waitForCompletion() {
		// Keep checking until queue is empty and no tasks are running
		while (this.queue.length > 0 || this.running > 0) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		return {
			results: this.results,
			errors: this.errors,
		};
	}
}

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

		// Step 3: Send requests in parallel with exactly 3 concurrent requests
		const limit = 1000;
		const maxPages = Math.ceil((totalCount ?? 1) / limit);

		// Use the custom RequestQueue to maintain exactly 3 requests at all times
		const requestQueue = new RequestQueue(3);

		for (let page = 1; page <= maxPages; page++) {
			requestQueue.add(() => getUserTorrentsList(rdKey, limit, page));
		}

		// Wait for all requests to complete
		const { results: pagesOfTorrents, errors } = await requestQueue.waitForCompletion();

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
	callback: (torrents: UserTorrent[]) => Promise<void>,
	customLimit?: number
) => {
	try {
		// Step 1: Get all magnets from AllDebrid
		const response = await getMagnetStatus(adKey);
		const magnetInfos = response.data.magnets;

		if (!magnetInfos.length) {
			await callback([]);
			return;
		}

		// Step 2: If limit input is set, apply it
		const limitedMagnets = customLimit ? magnetInfos.slice(0, customLimit) : magnetInfos;

		// Step 3: Process the magnets
		const torrents = await processAllDebridTorrents(limitedMagnets);
		await callback(torrents);
	} catch (error) {
		await callback([]);
		toast.error('Error fetching AllDebrid torrents list', genericToastOptions);
		console.error(error);
	}
};

export function convertToAllDebridUserTorrent(magnetInfo: MagnetStatus): UserTorrent {
	// Normalize filename if it's just a hash
	if (magnetInfo.filename === magnetInfo.hash) {
		magnetInfo.filename = 'Magnet';
	}

	// Determine media type
	let mediaType = getTypeByNameAndFileCount(magnetInfo.filename);

	// Get filenames for additional type detection
	const filenames = magnetInfo.links.map((f) => f.filename);
	const torrentAndFiles = [magnetInfo.filename, ...filenames];
	const hasEpisodes = checkArithmeticSequenceInFilenames(filenames);

	// Refine media type detection
	if (every(torrentAndFiles, (f) => !isVideo({ path: f }))) {
		// Default to movie if we can't determine the type but need a valid value
		mediaType = 'movie';
	} else if (
		hasEpisodes ||
		some(torrentAndFiles, (f) => /s\d\d\d?.?e\d\d\d?/i.test(f)) ||
		some(torrentAndFiles, (f) => /season.?\d+/i.test(f)) ||
		some(torrentAndFiles, (f) => /episodes?\s?\d+/i.test(f)) ||
		some(torrentAndFiles, (f) => /\b[a-fA-F0-9]{8}\b/.test(f))
	) {
		mediaType = 'tv';
	} else if (
		!hasEpisodes &&
		every(torrentAndFiles, (f) => !/s\d\d\d?.?e\d\d\d?/i.test(f)) &&
		every(torrentAndFiles, (f) => !/season.?\d+/i.test(f)) &&
		every(torrentAndFiles, (f) => !/episodes?\s?\d+/i.test(f)) &&
		every(torrentAndFiles, (f) => !/\b[a-fA-F0-9]{8}\b/.test(f))
	) {
		mediaType = 'movie';
	}

	// Parse filename for media info
	let info = {} as ParsedFilename;
	try {
		info =
			mediaType === 'movie'
				? filenameParse(magnetInfo.filename)
				: filenameParse(magnetInfo.filename, true);
	} catch (error) {
		// flip the condition if error is thrown
		mediaType = mediaType === 'movie' ? 'tv' : 'movie';
		try {
			info =
				mediaType === 'movie'
					? filenameParse(magnetInfo.filename)
					: filenameParse(magnetInfo.filename, true);
		} catch {
			// If both parsing attempts fail, leave info as empty object
		}
	}

	const date = new Date(magnetInfo.uploadDate * 1000);
	const serviceStatus = `${magnetInfo.statusCode}`;
	// Explicitly type the destructured values
	const [adStatus, adProgress] = getAdStatus(magnetInfo);

	// Ensure size is not zero to avoid division by zero
	if (magnetInfo.size === 0) magnetInfo.size = 1;

	// Create selected files array
	let idx = 0;
	const selectedFiles = magnetInfo.links.map((l) => ({
		fileId: idx++,
		filename: l.filename,
		filesize: l.size,
		link: l.link,
	}));

	return {
		info,
		mediaType,
		title: getMediaId(info, mediaType, false) || magnetInfo.filename,
		id: `ad:${magnetInfo.id}`,
		filename: magnetInfo.filename,
		hash: magnetInfo.hash,
		bytes: magnetInfo.size,
		seeders: magnetInfo.seeders,
		progress: adProgress,
		status: adStatus,
		serviceStatus,
		added: date,
		speed: magnetInfo.downloadSpeed || 0,
		links: magnetInfo.links.map((l) => l.link),
		adData: magnetInfo,
		selectedFiles,
	};
}

async function processAllDebridTorrents(magnetInfos: MagnetStatus[]): Promise<UserTorrent[]> {
	return Promise.all(magnetInfos.map(convertToAllDebridUserTorrent));
}

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

export const getAdStatus = (magnetInfo: MagnetStatus): [UserTorrentStatus, number] => {
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
