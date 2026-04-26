import { MagnetStatus, getMagnetStatus } from '@/services/allDebrid';
import { getUserTorrentsList } from '@/services/realDebrid';
import { getTorrentList } from '@/services/torbox';
import { TorBoxTorrentInfo, UserTorrentResponse } from '@/services/types';
import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { delay } from '@/utils/delay';
import { ParsedFilename, filenameParse } from '@ctrl/video-filename-parser';
import { AxiosError } from 'axios';
import { every, some } from 'lodash';
import toast from 'react-hot-toast';
import { getMediaId } from './mediaId';
import { getTypeByNameAndFileCount } from './mediaType';
import { checkArithmeticSequenceInFilenames, isVideo } from './selectable';
import { genericToastOptions } from './toastOptions';

// Extract error message from any error type
const getErrorMessage = (error: unknown): string | null => {
	if (error instanceof AxiosError) {
		const data = error.response?.data;
		return data?.error?.message || data?.detail || data?.error || null;
	}
	if (error instanceof Error) {
		return error.message;
	}
	return null;
};

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
			await delay(100);
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
		const limit = 5000; // Increased from 1000 to 5000 for better performance
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
		const apiError = getErrorMessage(error);
		toast.error(
			apiError ? `RD error: ${apiError}` : 'Failed to fetch Real-Debrid torrents.',
			genericToastOptions
		);
		console.error(error);
	}
};

export function convertToUserTorrent(torrentInfo: UserTorrentResponse): UserTorrent {
	// Provide defensive defaults for partially shaped inputs
	const filename = torrentInfo.filename || 'noname';
	const addedRaw =
		typeof torrentInfo.added === 'string' ? torrentInfo.added : new Date().toISOString();
	const serviceStatus = torrentInfo.status || 'unknown';
	const linksRaw = Array.isArray(torrentInfo.links) ? torrentInfo.links : [];

	let mediaType = getTypeByNameAndFileCount(filename);
	const status = getRdStatus({ ...torrentInfo, status: serviceStatus } as UserTorrentResponse);

	let info = {} as ParsedFilename;
	try {
		info = mediaType === 'movie' ? filenameParse(filename) : filenameParse(filename, true);
	} catch (error) {
		// flip the condition if error is thrown
		mediaType = mediaType === 'movie' ? 'tv' : 'movie';
		try {
			info = mediaType === 'movie' ? filenameParse(filename) : filenameParse(filename, true);
		} catch {
			// Leave info empty if parsing still fails
		}
	}

	return {
		...torrentInfo,
		info,
		status,
		serviceStatus,
		mediaType,
		added: new Date(addedRaw),
		id: `rd:${torrentInfo.id}`,
		// Decode any percent-encoded characters for display/use
		links: linksRaw.map((l) => {
			try {
				return decodeURIComponent(l);
			} catch {
				return l;
			}
		}),
		seeders: (torrentInfo as any).seeders || 0,
		speed: (torrentInfo as any).speed || 0,
		title: getMediaId(info, mediaType, false) || filename,
		selectedFiles: [],
	};
}

async function processTorrents(torrentData: UserTorrentResponse[]): Promise<UserTorrent[]> {
	const results = await Promise.all(
		torrentData.map(async (t) => {
			try {
				return convertToUserTorrent(t);
			} catch (e) {
				console.error('Failed to convert torrent:', e);
				return null;
			}
		})
	);
	return results.filter((x): x is UserTorrent => x !== null);
}

export const fetchAllDebrid = async (
	adKey: string,
	callback: (torrents: UserTorrent[]) => Promise<void>,
	customLimit?: number
) => {
	const startedAt = Date.now();
	console.log('[AllDebridFetch] start', {
		customLimit: customLimit ?? null,
	});
	try {
		// Step 1: Get all magnets from AllDebrid
		const apiStart = Date.now();
		const response = await getMagnetStatus(adKey);
		const magnetsCount = response.data?.magnets?.length ?? 0;
		console.log('[AllDebridFetch] apiSuccess', {
			magnetsCount,
			elapsedMs: Date.now() - apiStart,
		});
		const magnetInfos = response.data?.magnets || [];

		if (!magnetInfos.length) {
			console.log('[AllDebridFetch] noMagnets');
			await callback([]);
			console.log('[AllDebridFetch] end', {
				elapsedMs: Date.now() - startedAt,
				returned: 0,
			});
			return;
		}

		// Step 2: If limit input is set, apply it
		const limitedMagnets = customLimit ? magnetInfos.slice(0, customLimit) : magnetInfos;

		// Step 3: Process the magnets
		const torrents = await processAllDebridTorrents(limitedMagnets);
		await callback(torrents);
		console.log('[AllDebridFetch] end', {
			elapsedMs: Date.now() - startedAt,
			returned: torrents.length,
			customLimit: customLimit ?? null,
		});
	} catch (error) {
		await callback([]);
		const apiError = getErrorMessage(error);
		toast.error(
			apiError ? `AD error: ${apiError}` : 'Failed to fetch AllDebrid torrents.',
			genericToastOptions
		);
		console.error(error);
		console.error('[AllDebridFetch] error', {
			elapsedMs: Date.now() - startedAt,
			error,
		});
	}
};

export function convertToAllDebridUserTorrent(magnetInfo: MagnetStatus): UserTorrent {
	// Normalize filename if it's just a hash
	if (magnetInfo.filename === magnetInfo.hash) {
		magnetInfo.filename = 'Magnet';
	}

	// Determine media type
	let mediaType: UserTorrent['mediaType'] = getTypeByNameAndFileCount(magnetInfo.filename);

	// Get filenames for additional type detection
	const filenames = magnetInfo.links.map((f) => f.filename ?? '');
	const torrentAndFiles = [magnetInfo.filename, ...filenames];
	const hasEpisodes = checkArithmeticSequenceInFilenames(filenames);
	const noPlayableFiles =
		filenames.length > 0 && every(torrentAndFiles, (f) => !isVideo({ path: f }));

	// Refine media type detection
	if (noPlayableFiles) {
		mediaType = 'other';
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
	let info: ParsedFilename | undefined;
	if (mediaType !== 'other') {
		try {
			info =
				mediaType === 'movie'
					? filenameParse(magnetInfo.filename)
					: filenameParse(magnetInfo.filename, true);
		} catch (error) {
			// flip the condition if error is thrown
			const fallbackType: Exclude<UserTorrent['mediaType'], 'other'> =
				mediaType === 'movie' ? 'tv' : 'movie';
			mediaType = fallbackType;
			try {
				info =
					fallbackType === 'movie'
						? filenameParse(magnetInfo.filename)
						: filenameParse(magnetInfo.filename, true);
			} catch {
				info = undefined;
			}
		}
	}

	const date = new Date((magnetInfo.uploadDate || 0) * 1000);
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

	const infoForMediaId = info ?? magnetInfo.filename;

	return {
		info,
		mediaType,
		title: getMediaId(infoForMediaId, mediaType, false) || magnetInfo.filename,
		id: `ad:${magnetInfo.id}`,
		filename: magnetInfo.filename,
		hash: magnetInfo.hash || '',
		bytes: magnetInfo.size,
		seeders: magnetInfo.seeders || 0,
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
		case 'magnet_error':
		case 'error':
		case 'virus':
		case 'dead':
			status = UserTorrentStatus.error;
			break;
		default:
			status = UserTorrentStatus.error;
			break;
	}
	return status;
};

export const convertToTbUserTorrent = (info: TorBoxTorrentInfo): UserTorrent => {
	let mediaType: UserTorrent['mediaType'] = getTypeByNameAndFileCount(info.name);
	const serviceStatus = info.download_state;
	let status: UserTorrentStatus;

	// Map TorBox status to UserTorrentStatus
	// Check download_finished flag first, as TorBox can show "uploading" when seeding after completion
	if (info.download_finished) {
		status = UserTorrentStatus.finished;
	} else {
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
	}

	const filenames = info.files?.map((file) => file.name ?? '') ?? [];
	const torrentAndFiles = [info.name, ...filenames];
	const hasEpisodes = checkArithmeticSequenceInFilenames(filenames);
	const noPlayableFiles =
		filenames.length > 0 && every(torrentAndFiles, (f) => !isVideo({ path: f }));

	if (noPlayableFiles) {
		mediaType = 'other';
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
	let parsedInfo: ParsedFilename | undefined;
	if (mediaType !== 'other') {
		try {
			parsedInfo =
				mediaType === 'movie' ? filenameParse(info.name) : filenameParse(info.name, true);
		} catch (error) {
			const fallbackType: Exclude<UserTorrent['mediaType'], 'other'> =
				mediaType === 'movie' ? 'tv' : 'movie';
			mediaType = fallbackType;
			try {
				parsedInfo =
					fallbackType === 'movie'
						? filenameParse(info.name)
						: filenameParse(info.name, true);
			} catch {
				parsedInfo = undefined;
			}
		}
	}

	if (parsedInfo && (!parsedInfo.title || !/\w/.test(parsedInfo.title))) {
		parsedInfo = undefined;
	}

	// Convert TorBoxFile[] to SelectedFile[]
	const selectedFiles =
		info.files?.map((file, index) => ({
			fileId: index,
			filename: file.name,
			filesize: file.size,
			link: file.s3_path || '',
		})) ?? [];

	// Ensure progress reflects completed state when finished/cached
	const computedProgress =
		status === UserTorrentStatus.finished ||
		info.download_finished ||
		(info as any).download_present
			? 100
			: info.progress;

	const infoForMediaId = parsedInfo ?? info.name;

	return {
		id: `tb:${info.id}`,
		links: selectedFiles.map((f) => f.link).filter(Boolean),
		seeders: info.seeds,
		speed: info.download_speed,
		title: getMediaId(infoForMediaId, mediaType, false) || info.name,
		selectedFiles,
		filename: info.name,
		bytes: info.size,
		status,
		serviceStatus,
		progress: computedProgress,
		added: new Date(info.created_at),
		hash: info.hash,
		mediaType,
		info: parsedInfo,
		tbData: info,
	};
};

const getAdStatus = (magnetInfo: MagnetStatus): [UserTorrentStatus, number] => {
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
			progress = ((magnetInfo.downloaded || 0) / (magnetInfo.size || 1)) * 100;
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

export const fetchTorBox = async (
	tbKey: string,
	callback: (torrents: UserTorrent[]) => Promise<void>,
	customLimit?: number
) => {
	const startedAt = Date.now();
	console.log('[TorBoxFetch] start', {
		customLimit: customLimit ?? null,
	});
	try {
		// Get all torrents from TorBox
		const apiStart = Date.now();
		const response = await getTorrentList(tbKey);
		console.log('[TorBoxFetch] apiSuccess', {
			success: response.success,
			elapsedMs: Date.now() - apiStart,
			dataShape: Array.isArray(response.data) ? 'array' : response.data ? 'object' : 'empty',
		});

		if (!response.success || !response.data) {
			console.log('[TorBoxFetch] noData', {
				success: response.success,
			});
			await callback([]);
			console.log('[TorBoxFetch] end', {
				elapsedMs: Date.now() - startedAt,
				returned: 0,
			});
			return;
		}

		// Handle both single torrent and array responses
		const torrentInfos = Array.isArray(response.data) ? response.data : [response.data];

		if (!torrentInfos.length) {
			console.log('[TorBoxFetch] emptyList');
			await callback([]);
			console.log('[TorBoxFetch] end', {
				elapsedMs: Date.now() - startedAt,
				returned: 0,
			});
			return;
		}

		// Apply custom limit if specified
		const limitedTorrents = customLimit ? torrentInfos.slice(0, customLimit) : torrentInfos;

		// Process the torrents
		const torrents = await processTorBoxTorrents(limitedTorrents);
		await callback(torrents);
		console.log('[TorBoxFetch] end', {
			elapsedMs: Date.now() - startedAt,
			returned: torrents.length,
			customLimit: customLimit ?? null,
		});
	} catch (error) {
		await callback([]);
		const apiError = getErrorMessage(error);
		toast.error(
			apiError ? `TorBox error: ${apiError}` : 'Failed to fetch TorBox torrents.',
			genericToastOptions
		);
		console.error(error);
		console.error('[TorBoxFetch] error', {
			elapsedMs: Date.now() - startedAt,
			error,
		});
	}
};

async function processTorBoxTorrents(torrentInfos: TorBoxTorrentInfo[]): Promise<UserTorrent[]> {
	return Promise.all(torrentInfos.map(convertToTbUserTorrent));
}
