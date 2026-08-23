import { MagnetStatus, getMagnetStatus } from '@/services/allDebrid';
import {
	listAllPremiumizeItems,
	listPremiumizeFolder,
	listPremiumizeTransfers,
	resolvePremiumizeTransferHashes,
	type PremiumizeFolderEntry,
	type PremiumizeItem,
	type PremiumizeTransfer,
} from '@/services/premiumize';
import { getUserTorrentsList } from '@/services/realDebrid';
import { getTorrentList, getWebDownloadList } from '@/services/torbox';
import { TorBoxTorrentInfo, TorBoxWebDownload, UserTorrentResponse } from '@/services/types';
import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { delay } from '@/utils/delay';
import { ParsedFilename, filenameParse } from '@ctrl/video-filename-parser';
import { AxiosError } from 'axios';
import { every, some } from 'lodash';
import toast from 'react-hot-toast';
import { getMediaId } from './mediaId';
import { getTypeByNameAndFileCount } from './mediaType';
import { toPremiumizeRowId, type PremiumizeRowKind } from './premiumizeRow';
import { checkArithmeticSequenceInFilenames, isVideo } from './selectable';
import { genericToastOptions } from './toastOptions';
import { toWebDownloadRowId } from './torboxWebDownload';

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

// A web download carries every field the library reads off a torrent except the
// swarm ones, so it is padded out here rather than threaded through every
// display helper as a second shape.
const webDownloadAsTorrentInfo = (info: TorBoxWebDownload): TorBoxTorrentInfo => ({
	...info,
	magnet: '',
	seeds: 0,
	peers: 0,
	ratio: 0,
	upload_speed: info.upload_speed ?? 0,
	torrent_file: false,
	inactive_check: info.inactive_check ?? 0,
	availability: info.availability ?? 0,
});

const buildTbUserTorrent = (
	info: TorBoxTorrentInfo | TorBoxWebDownload,
	isWebDownload: boolean
): UserTorrent => {
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
		id: isWebDownload ? toWebDownloadRowId(info.id) : `tb:${info.id}`,
		links: selectedFiles.map((f) => f.link).filter(Boolean),
		seeders: 'seeds' in info ? info.seeds : 0,
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
		tbData: isWebDownload
			? webDownloadAsTorrentInfo(info as TorBoxWebDownload)
			: (info as TorBoxTorrentInfo),
	};
};

export const convertToTbUserTorrent = (info: TorBoxTorrentInfo): UserTorrent =>
	buildTbUserTorrent(info, false);

export const convertToTbWebDownloadUserTorrent = (info: TorBoxWebDownload): UserTorrent =>
	buildTbUserTorrent(info, true);

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

// TorBox returns a bare object instead of an array when a single id is asked for
const asTorBoxList = <T>(data: T[] | T | null | undefined): T[] =>
	!data ? [] : Array.isArray(data) ? data : [data];

// Web downloads sit in a list of their own. Losing them must not cost the user
// their torrents, so a failure here degrades to an empty list.
const fetchTorBoxWebDownloadList = async (tbKey: string): Promise<TorBoxWebDownload[]> => {
	try {
		const response = await getWebDownloadList(tbKey);
		if (!response?.success) return [];
		return asTorBoxList(response.data);
	} catch (error) {
		console.error('[TorBoxFetch] webDownloadsError', {
			error: getErrorMessage(error) ?? error,
		});
		return [];
	}
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
		// Get all torrents and web downloads from TorBox
		const apiStart = Date.now();
		const [response, webDownloadInfos] = await Promise.all([
			getTorrentList(tbKey),
			fetchTorBoxWebDownloadList(tbKey),
		]);
		console.log('[TorBoxFetch] apiSuccess', {
			success: response.success,
			elapsedMs: Date.now() - apiStart,
			dataShape: Array.isArray(response.data) ? 'array' : response.data ? 'object' : 'empty',
			webDownloads: webDownloadInfos.length,
		});

		const torrentInfos = response.success ? asTorBoxList(response.data) : [];

		if (!torrentInfos.length && !webDownloadInfos.length) {
			console.log(
				response.success && response.data
					? '[TorBoxFetch] emptyList'
					: '[TorBoxFetch] noData',
				{ success: response.success }
			);
			await callback([]);
			console.log('[TorBoxFetch] end', {
				elapsedMs: Date.now() - startedAt,
				returned: 0,
			});
			return;
		}

		// Apply custom limit if specified
		const limitedTorrents = customLimit ? torrentInfos.slice(0, customLimit) : torrentInfos;
		const limitedWebDownloads = customLimit
			? webDownloadInfos.slice(0, customLimit)
			: webDownloadInfos;

		// Process the torrents
		const torrents = [
			...(await processTorBoxTorrents(limitedTorrents)),
			...limitedWebDownloads.map(convertToTbWebDownloadUserTorrent),
		];
		await callback(torrents);
		console.log('[TorBoxFetch] end', {
			elapsedMs: Date.now() - startedAt,
			returned: torrents.length,
			webDownloads: limitedWebDownloads.length,
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
	return Promise.all(torrentInfos.map((info) => convertToTbUserTorrent(info)));
}

// ==================== Premiumize ====================

/**
 * Premiumize reports a transfer's status but never its info hash, its size or
 * its files, and it reports the cloud's files but never which transfer produced
 * them. A library row needs both halves, so they are joined here: the transfer
 * carries status and progress, the cloud carries bytes and file names, and the
 * folder name is the only key between them.
 */
type PremiumizeRowSource = {
	kind: PremiumizeRowKind;
	id: string;
	name: string;
	/** Files from `item/listall`, already narrowed to this row. */
	files: PremiumizeItem[];
	transfer?: PremiumizeTransfer;
};

const PM_STATUS: Record<string, UserTorrentStatus> = {
	queued: UserTorrentStatus.waiting,
	running: UserTorrentStatus.downloading,
	finished: UserTorrentStatus.finished,
	seeding: UserTorrentStatus.finished,
	error: UserTorrentStatus.error,
};

/**
 * `progress` and `message` are documented as 1.0 and "" on a finished transfer
 * and are `null` in production, so `progress * 100` renders NaN unless it is
 * coalesced. A row with no transfer behind it is content already sitting in the
 * cloud, which is finished by definition.
 */
const getPmProgress = (transfer?: PremiumizeTransfer): [UserTorrentStatus, number] => {
	if (!transfer) return [UserTorrentStatus.finished, 100];
	const status = PM_STATUS[transfer.status] ?? UserTorrentStatus.error;
	if (status === UserTorrentStatus.finished) return [status, 100];
	return [status, Math.round((transfer.progress ?? 0) * 100)];
};

export function convertToPremiumizeUserTorrent(
	source: PremiumizeRowSource,
	hash: string
): UserTorrent {
	const filenames = source.files.map((file) => file.name);
	const torrentAndFiles = [source.name, ...filenames];
	const hasEpisodes = checkArithmeticSequenceInFilenames(filenames);
	const noPlayableFiles =
		filenames.length > 0 && every(torrentAndFiles, (f) => !isVideo({ path: f }));

	let mediaType: UserTorrent['mediaType'] = getTypeByNameAndFileCount(source.name);
	if (noPlayableFiles) {
		mediaType = 'other';
	} else if (
		hasEpisodes ||
		some(torrentAndFiles, (f) => /s\d\d\d?.?e\d\d\d?/i.test(f)) ||
		some(torrentAndFiles, (f) => /season.?\d+/i.test(f)) ||
		some(torrentAndFiles, (f) => /episodes?\s?\d+/i.test(f))
	) {
		mediaType = 'tv';
	}

	let info: ParsedFilename | undefined;
	if (mediaType !== 'other') {
		try {
			info =
				mediaType === 'movie'
					? filenameParse(source.name)
					: filenameParse(source.name, true);
		} catch {
			info = undefined;
		}
	}
	if (info && (!info.title || !/\w/.test(info.title))) info = undefined;

	const [status, progress] = getPmProgress(source.transfer);
	const bytes = source.files.reduce((total, file) => total + (file.size || 0), 0);
	// Premiumize stamps no time on a transfer, so the earliest file is the only
	// record of when the content arrived.
	const createdAt = source.files.reduce(
		(earliest, file) =>
			file.created_at && file.created_at < earliest ? file.created_at : earliest,
		Number.MAX_SAFE_INTEGER
	);

	return {
		id: toPremiumizeRowId(source.kind, source.id),
		filename: source.name,
		title: getMediaId(info ?? source.name, mediaType, false) || source.name,
		hash,
		bytes,
		progress,
		status,
		serviceStatus: source.transfer?.status ?? 'stored',
		added: createdAt === Number.MAX_SAFE_INTEGER ? new Date() : new Date(createdAt * 1000),
		mediaType,
		info,
		// Premiumize links expire and cost nothing to re-mint, so none are stored;
		// playback resolves from the file id (or the hash) on demand.
		links: [],
		selectedFiles: source.files.map((file) => ({
			fileId: file.id,
			filename: file.name,
			filesize: file.size,
			link: '',
		})),
		seeders: 0,
		speed: 0,
	};
}

/** Files in `item/listall` are addressed by path; a row owns everything under its folder. */
const groupPremiumizeItemsByTopFolder = (items: PremiumizeItem[]) => {
	const byFolder = new Map<string, PremiumizeItem[]>();
	const rootFiles = new Map<string, PremiumizeItem>();
	for (const item of items) {
		const separator = item.path?.indexOf('/') ?? -1;
		if (separator < 0) {
			rootFiles.set(item.id, item);
			continue;
		}
		const folder = item.path.slice(0, separator);
		const bucket = byFolder.get(folder);
		if (bucket) bucket.push(item);
		else byFolder.set(folder, [item]);
	}
	return { byFolder, rootFiles };
};

export function buildPremiumizeRowSources(
	transfers: PremiumizeTransfer[],
	rootContent: PremiumizeFolderEntry[],
	items: PremiumizeItem[]
): PremiumizeRowSource[] {
	const { byFolder, rootFiles } = groupPremiumizeItemsByTopFolder(items);
	const folderNameById = new Map(
		rootContent
			.filter((entry) => entry.type === 'folder')
			.map((entry) => [entry.id, entry.name])
	);

	const claimedFolders = new Set<string>();
	const claimedFiles = new Set<string>();
	const sources: PremiumizeRowSource[] = [];

	for (const transfer of transfers) {
		if (transfer.folder_id) {
			claimedFolders.add(transfer.folder_id);
			const name = folderNameById.get(transfer.folder_id) ?? transfer.name;
			sources.push({
				kind: 'transfer',
				id: transfer.id,
				name,
				files: byFolder.get(name) ?? [],
				transfer,
			});
			continue;
		}
		if (transfer.file_id) {
			claimedFiles.add(transfer.file_id);
			const file = rootFiles.get(transfer.file_id);
			sources.push({
				kind: 'transfer',
				id: transfer.id,
				name: file?.name ?? transfer.name,
				files: file ? [file] : [],
				transfer,
			});
			continue;
		}
		// Still queued, errored, or routed to an external cloud: both ids are
		// null, which is not an error condition and must still show as a row.
		sources.push({
			kind: 'transfer',
			id: transfer.id,
			name: transfer.name,
			files: [],
			transfer,
		});
	}

	// Content whose transfer record is gone - `transfer/clearfinished` removes
	// records and leaves the files - would otherwise be invisible in DMM.
	for (const entry of rootContent) {
		if (entry.type === 'folder') {
			if (claimedFolders.has(entry.id)) continue;
			sources.push({
				kind: 'folder',
				id: entry.id,
				name: entry.name,
				files: byFolder.get(entry.name) ?? [],
			});
		} else {
			if (claimedFiles.has(entry.id)) continue;
			const file = rootFiles.get(entry.id);
			sources.push({
				kind: 'file',
				id: entry.id,
				name: entry.name,
				files: file ? [file] : [],
			});
		}
	}

	return sources;
}

export const fetchPremiumize = async (
	pmKey: string,
	callback: (torrents: UserTorrent[]) => Promise<void>,
	customLimit?: number
) => {
	const startedAt = Date.now();
	console.log('[PremiumizeFetch] start', { customLimit: customLimit ?? null });
	try {
		// Three calls for the whole library, whatever its size: the transfer
		// queue, the root listing and every file in the account.
		const [transfers, root, items] = await Promise.all([
			listPremiumizeTransfers(pmKey),
			listPremiumizeFolder(pmKey),
			listAllPremiumizeItems(pmKey),
		]);

		const sources = buildPremiumizeRowSources(transfers, root.content ?? [], items);
		const limited = customLimit ? sources.slice(0, customLimit) : sources;

		if (limited.length === 0) {
			await callback([]);
			console.log('[PremiumizeFetch] end', {
				elapsedMs: Date.now() - startedAt,
				returned: 0,
			});
			return;
		}

		// Only a live transfer can give up its info hash, and only through the
		// `job/src` redirect - one request each, which is why it is done for the
		// transfer rows alone and never for the whole cloud.
		const hashes = await resolvePremiumizeTransferHashes(
			pmKey,
			limited.filter((source) => source.kind === 'transfer').map((source) => source.id)
		);

		const torrents = limited.map((source) =>
			convertToPremiumizeUserTorrent(source, hashes[source.id] ?? '')
		);
		await callback(torrents);
		console.log('[PremiumizeFetch] end', {
			elapsedMs: Date.now() - startedAt,
			returned: torrents.length,
			withHash: Object.keys(hashes).length,
		});
	} catch (error) {
		await callback([]);
		const apiError = getErrorMessage(error);
		toast.error(
			apiError ? `Premiumize error: ${apiError}` : 'Failed to fetch Premiumize transfers.',
			genericToastOptions
		);
		console.error('[PremiumizeFetch] error', { elapsedMs: Date.now() - startedAt, error });
	}
};
