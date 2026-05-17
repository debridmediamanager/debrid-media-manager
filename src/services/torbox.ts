import { delay as delayWithMessageChannel } from '@/utils/delay';
import axios, { InternalAxiosRequestConfig } from 'axios';
import getConfig from 'next/config';
import {
	TorBoxCachedItem,
	TorBoxCachedResponse,
	TorBoxCreateTorrentResponse,
	TorBoxResponse,
	TorBoxTorrentInfo,
	TorBoxTorrentMetadata,
	TorBoxUser,
} from './types';

export type { TorBoxTorrentInfo, TorBoxUser };

// Safely access Next.js runtime config in test/non-Next environments
const fallbackRuntimeConfig = {
	proxy: '',
	torboxHostname: 'https://api.torbox.app',
};

const config = (() => {
	try {
		const cfg = (getConfig as any)?.();
		return cfg?.publicRuntimeConfig ?? fallbackRuntimeConfig;
	} catch {
		return fallbackRuntimeConfig;
	}
})();

// Constants
const REQUEST_TIMEOUT = 10000;
const BASE_URL = 'https://api.torbox.app';
const API_VERSION = 'v1';

// Per-endpoint rate budgets (requests per minute)
const ENDPOINT_LIMITS: Record<string, number> = {
	requestdl: 80,
	createtorrent: 50,
	default: 250,
};

const MAX_GLOBAL_CONCURRENT = 15;
const DEFAULT_RETRY_AFTER_MS = 300_000; // 5 minutes

// Rate limiting state
let globalConcurrent = 0;
let globalPausedUntil = 0;
const endpointTimestamps: Record<string, number[]> = {};
const concurrencyWaiters: Array<() => void> = [];

// Custom error class for rate limiting
export class TorBoxRateLimitError extends Error {
	constructor(message: string = 'TorBox API rate limit exceeded. Please wait and try again.') {
		super(message);
		this.name = 'TorBoxRateLimitError';
	}
}

function getEndpointKey(url?: string): string {
	if (!url) return 'default';
	if (url.includes('/requestdl')) return 'requestdl';
	if (url.includes('/createtorrent')) return 'createtorrent';
	return 'default';
}

async function acquireConcurrencySlot(): Promise<void> {
	while (globalConcurrent >= MAX_GLOBAL_CONCURRENT) {
		await new Promise<void>((resolve) => concurrencyWaiters.push(resolve));
	}
	globalConcurrent++;
}

function releaseConcurrencySlot(): void {
	globalConcurrent = Math.max(0, globalConcurrent - 1);
	const waiter = concurrencyWaiters.shift();
	if (waiter) waiter();
}

async function enforceEndpointLimit(endpointKey: string): Promise<void> {
	// Global pause from 429
	const pauseRemaining = globalPausedUntil - Date.now();
	if (pauseRemaining > 0) {
		console.log(
			`[TorBox] Global rate limit pause, waiting ${Math.round(pauseRemaining / 1000)}s`
		);
		await delayWithMessageChannel(pauseRemaining);
	}

	const limit = ENDPOINT_LIMITS[endpointKey] ?? ENDPOINT_LIMITS.default;
	if (!endpointTimestamps[endpointKey]) endpointTimestamps[endpointKey] = [];
	const timestamps = endpointTimestamps[endpointKey];

	const now = Date.now();
	const windowStart = now - 60_000;
	// Prune old entries
	while (timestamps.length > 0 && timestamps[0] < windowStart) timestamps.shift();

	if (timestamps.length >= limit) {
		const waitMs = timestamps[0] + 60_000 - now + Math.random() * 500;
		console.log(
			`[TorBox] ${endpointKey} rate limit (${timestamps.length}/${limit}/min), waiting ${Math.round(waitMs)}ms`
		);
		await delayWithMessageChannel(waitMs);
		// Re-prune after waiting
		const now2 = Date.now();
		while (timestamps.length > 0 && timestamps[0] < now2 - 60_000) timestamps.shift();
	}

	timestamps.push(Date.now());
}

// Add a cache-aware ID generator to ensure unique cache entries for retries
let requestCount = 0;
function getUniqueRequestId() {
	return `req-${Date.now()}-${requestCount++}`;
}

interface ExtendedAxiosRequestConfig extends InternalAxiosRequestConfig {
	__isRetryRequest?: boolean;
	__retryCount?: number;
	__torboxToken?: string;
	__skipRetry?: boolean;
	__endpointKey?: string;
	__slotAcquired?: boolean;
}

function calculateRetryDelay(retryCount: number, retryAfterMs?: number): number {
	if (retryAfterMs && retryAfterMs > 0) {
		return retryAfterMs + Math.random() * 5000;
	}
	const baseDelay = Math.pow(2, retryCount - 1) * 1000;
	const cappedDelay = Math.min(baseDelay, DEFAULT_RETRY_AFTER_MS);
	const jitterFactor = 0.8 + Math.random() * 0.4;
	return cappedDelay * jitterFactor;
}

function parseRetryAfterMs(error: any): number | undefined {
	const retryAfter = error.response?.headers?.['retry-after'];
	if (retryAfter) {
		const seconds = parseInt(retryAfter, 10);
		if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
	}
	return undefined;
}

function getProxyUrl(baseUrl: string): string {
	return baseUrl;
}

// Get the base URL for TorBox API (with or without proxy)
// Server-side calls bypass the proxy (the CF Worker rejects them with 403);
// client-side calls go through the proxy to avoid CORS.
function getTorBoxBaseUrl(): string {
	const torboxHost = config.torboxHostname || BASE_URL;
	const isServer = typeof window === 'undefined';
	if (config.proxy && !isServer) {
		return `${getProxyUrl(config.proxy)}${torboxHost}`;
	}
	return torboxHost;
}

// Create a global axios instance for TorBox API requests
const torBoxAxios = axios.create({
	timeout: REQUEST_TIMEOUT,
});

torBoxAxios.interceptors.request.use(async (config: ExtendedAxiosRequestConfig) => {
	const endpointKey = getEndpointKey(config.url);
	config.__endpointKey = endpointKey;

	if (!config.__slotAcquired) {
		await acquireConcurrencySlot();
		config.__slotAcquired = true;
	}

	await enforceEndpointLimit(endpointKey);

	if (config.__isRetryRequest && config.url) {
		const url = new URL(config.url, 'http://dummy-base.com');
		url.searchParams.set('_cache_buster', getUniqueRequestId());
		config.url = config.url.startsWith('http') ? url.toString() : url.pathname + url.search;
	}

	return config;
});

torBoxAxios.interceptors.response.use(
	(response) => {
		const cfg = response.config as ExtendedAxiosRequestConfig;
		if (cfg.__slotAcquired) {
			releaseConcurrencySlot();
			cfg.__slotAcquired = false;
		}
		return response;
	},
	async (error) => {
		const originalConfig = error.config as ExtendedAxiosRequestConfig;

		if (!originalConfig) {
			return Promise.reject(error);
		}

		const releaseSlot = () => {
			if (originalConfig.__slotAcquired) {
				releaseConcurrencySlot();
				originalConfig.__slotAcquired = false;
			}
		};

		if (originalConfig.__skipRetry) {
			releaseSlot();
			return Promise.reject(error);
		}

		if (originalConfig.__retryCount === undefined) {
			originalConfig.__retryCount = 0;
		}

		const status = error.response?.status;
		const is429 = status === 429;
		const maxRetries = is429 ? 3 : 7;

		if (originalConfig.__retryCount >= maxRetries) {
			releaseSlot();
			if (is429) return Promise.reject(new TorBoxRateLimitError());
			return Promise.reject(error);
		}

		const shouldRetry = (status >= 500 && status < 600) || is429;
		if (!shouldRetry) {
			releaseSlot();
			return Promise.reject(error);
		}

		originalConfig.__retryCount++;
		originalConfig.__isRetryRequest = true;

		let retryAfterMs: number | undefined;
		if (is429) {
			retryAfterMs = parseRetryAfterMs(error) ?? DEFAULT_RETRY_AFTER_MS;
			globalPausedUntil = Date.now() + retryAfterMs;
		}

		const retryDelay = calculateRetryDelay(originalConfig.__retryCount, retryAfterMs);
		const errorType = is429 ? 'rate limit' : 'server';
		console.log(
			`[TorBox] ${originalConfig.__endpointKey} ${status} ${errorType}. Retry ${originalConfig.__retryCount}/${maxRetries} after ${Math.round(retryDelay / 1000)}s`
		);

		// Release slot before waiting so other requests aren't blocked during the pause
		releaseSlot();
		await delayWithMessageChannel(retryDelay);

		try {
			return await torBoxAxios.request(originalConfig);
		} catch (retryError) {
			return Promise.reject(retryError);
		}
	}
);

// Helper function to get axios config with token
function getAxiosConfig(token: string) {
	return {
		headers: token ? { Authorization: `Bearer ${token}` } : {},
	};
}

// ==================== Torrents API ====================

export const createTorrent = async (
	accessToken: string,
	params: {
		file?: File;
		magnet?: string;
		seed?: '1' | '2' | '3';
		allow_zip?: boolean;
		name?: string;
		as_queued?: boolean;
		add_only_if_cached?: boolean;
	}
): Promise<TorBoxResponse<TorBoxCreateTorrentResponse>> => {
	const formData = new FormData();

	if (params.file) formData.append('file', params.file);
	if (params.magnet) formData.append('magnet', params.magnet);
	if (params.seed) formData.append('seed', params.seed);
	if (params.allow_zip !== undefined) formData.append('allow_zip', params.allow_zip.toString());
	if (params.name) formData.append('name', params.name);
	if (params.as_queued !== undefined) formData.append('as_queued', params.as_queued.toString());
	if (params.add_only_if_cached !== undefined)
		formData.append('add_only_if_cached', params.add_only_if_cached.toString());

	const response = await torBoxAxios.post<TorBoxResponse<TorBoxCreateTorrentResponse>>(
		`${getTorBoxBaseUrl()}/${API_VERSION}/api/torrents/createtorrent`,
		formData,
		getAxiosConfig(accessToken)
	);
	return response.data;
};

export const controlTorrent = async (
	accessToken: string,
	params: {
		torrent_id?: number;
		operation: 'reannounce' | 'delete' | 'resume' | 'pause';
		all?: boolean;
	}
): Promise<TorBoxResponse<null>> => {
	const response = await torBoxAxios.post<TorBoxResponse<null>>(
		`${getTorBoxBaseUrl()}/${API_VERSION}/api/torrents/controltorrent`,
		params,
		getAxiosConfig(accessToken)
	);
	return response.data;
};

export const deleteTorrent = async (
	accessToken: string,
	torrent_id: number
): Promise<TorBoxResponse<null>> => {
	return controlTorrent(accessToken, { torrent_id, operation: 'delete' });
};

export const getTorrentList = async (
	accessToken: string,
	params?: {
		bypass_cache?: boolean;
		id?: number;
		offset?: number;
		limit?: number;
	}
): Promise<TorBoxResponse<TorBoxTorrentInfo[] | TorBoxTorrentInfo>> => {
	const requestMeta = {
		hasId: Boolean(params?.id),
		offset: params?.offset ?? 0,
		limit: params?.limit ?? 'default',
	};
	const requestStartedAt = Date.now();
	console.log('[TorboxAPI] getTorrentList start', requestMeta);

	// Add fresh query parameter to get uncached results
	const queryParams = {
		...params,
		bypass_cache: true, // Always fetch fresh uncached results
		_fresh: Date.now(), // Additional cache-busting parameter
	};

	const response = await torBoxAxios.get<TorBoxResponse<TorBoxTorrentInfo[] | TorBoxTorrentInfo>>(
		`${getTorBoxBaseUrl()}/${API_VERSION}/api/torrents/mylist`,
		{ params: queryParams, ...getAxiosConfig(accessToken) }
	);
	const result = response.data;
	const itemCount = Array.isArray(result.data) ? result.data.length : result.data ? 1 : 0;
	const durationMs = Date.now() - requestStartedAt;
	console.log('[TorboxAPI] getTorrentList success', {
		...requestMeta,
		success: result.success,
		itemCount,
		elapsedMs: durationMs,
	});
	return result;
};

export const requestDownloadLink = async (
	accessToken: string,
	params: {
		torrent_id: number;
		file_id?: number;
		zip_link?: boolean;
		user_ip?: string;
		redirect?: boolean;
	},
	options?: { skipRetry?: boolean; timeout?: number }
): Promise<TorBoxResponse<string>> => {
	const response = await torBoxAxios.get<TorBoxResponse<string>>(
		`${getTorBoxBaseUrl()}/${API_VERSION}/api/torrents/requestdl`,
		{
			params: {
				token: accessToken,
				...params,
			},
			...getAxiosConfig(accessToken),
			...(options?.timeout && { timeout: options.timeout }),
			...(options?.skipRetry && { __skipRetry: true }),
		} as any
	);
	return response.data;
};

export const checkCachedStatus = async (
	params: {
		hash: string | string[];
		format?: 'object' | 'list';
		list_files?: boolean;
	},
	accessToken?: string
): Promise<TorBoxResponse<TorBoxCachedResponse | TorBoxCachedItem[] | null>> => {
	const hashString = Array.isArray(params.hash) ? params.hash.join(',') : params.hash;

	const response = await torBoxAxios.get<
		TorBoxResponse<TorBoxCachedResponse | TorBoxCachedItem[] | null>
	>(`${getTorBoxBaseUrl()}/${API_VERSION}/api/torrents/checkcached`, {
		params: {
			hash: hashString,
			format: params.format || 'object',
			list_files: params.list_files,
		},
		...getAxiosConfig(accessToken || ''),
	});
	return response.data;
};

export const exportTorrentData = async (
	accessToken: string,
	params: {
		torrent_id: number;
		type: 'magnet' | 'file';
	}
): Promise<TorBoxResponse<string> | Blob> => {
	try {
		if (params.type === 'file') {
			const response = await torBoxAxios.get(
				`${getTorBoxBaseUrl()}/${API_VERSION}/api/torrents/exportdata`,
				{
					params,
					responseType: 'blob',
					...getAxiosConfig(accessToken),
				}
			);
			return response.data;
		} else {
			const response = await torBoxAxios.get<TorBoxResponse<string>>(
				`${getTorBoxBaseUrl()}/${API_VERSION}/api/torrents/exportdata`,
				{ params, ...getAxiosConfig(accessToken) }
			);
			return response.data;
		}
	} catch (error: any) {
		console.error('Error exporting torrent data:', error.message);
		throw error;
	}
};

export const getTorrentInfo = async (params: {
	hash?: string;
	timeout?: number;
	magnet?: string;
	file?: File;
}): Promise<TorBoxResponse<TorBoxTorrentMetadata>> => {
	try {
		if (params.hash && !params.magnet && !params.file) {
			// Use GET method for hash-only requests
			const response = await torBoxAxios.get<TorBoxResponse<TorBoxTorrentMetadata>>(
				`${getTorBoxBaseUrl()}/${API_VERSION}/api/torrents/torrentinfo`,
				{ params }
			);
			return response.data;
		} else {
			// Use POST method for magnet or file
			const formData = new FormData();
			if (params.magnet) formData.append('magnet', params.magnet);
			if (params.file) formData.append('file', params.file);
			if (params.hash) formData.append('hash', params.hash);
			if (params.timeout) formData.append('timeout', params.timeout.toString());

			const response = await torBoxAxios.post<TorBoxResponse<TorBoxTorrentMetadata>>(
				`${getTorBoxBaseUrl()}/${API_VERSION}/api/torrents/torrentinfo`,
				formData
			);
			return response.data;
		}
	} catch (error: any) {
		console.error('Error getting torrent info:', error.message);
		throw error;
	}
};

// ==================== User API ====================

export const getUserData = async (
	accessToken: string,
	params?: {
		settings?: boolean;
	}
): Promise<TorBoxResponse<TorBoxUser>> => {
	try {
		const response = await torBoxAxios.get<TorBoxResponse<TorBoxUser>>(
			`${getTorBoxBaseUrl()}/${API_VERSION}/api/user/me`,
			{
				params: {
					settings: params?.settings,
				},
				...getAxiosConfig(accessToken),
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error getting user data:', error.message);
		throw error;
	}
};

export const refreshApiToken = async (
	accessToken: string
): Promise<TorBoxResponse<{ token: string }>> => {
	try {
		const response = await torBoxAxios.post<TorBoxResponse<{ token: string }>>(
			`${getTorBoxBaseUrl()}/${API_VERSION}/api/user/refreshtoken`,
			undefined,
			getAxiosConfig(accessToken)
		);
		return response.data;
	} catch (error: any) {
		console.error('Error refreshing API token:', error.message);
		throw error;
	}
};

// ==================== Stats API ====================

export const getStats = async (): Promise<TorBoxResponse<any>> => {
	try {
		const response = await torBoxAxios.get<TorBoxResponse>(
			`${getTorBoxBaseUrl()}/${API_VERSION}/api/stats`
		);
		return response.data;
	} catch (error: any) {
		console.error('Error getting stats:', error.message);
		throw error;
	}
};

export const _testing = {
	getEndpointKey,
	calculateRetryDelay,
	parseRetryAfterMs,
	acquireConcurrencySlot,
	releaseConcurrencySlot,
	enforceEndpointLimit,
	get globalConcurrent() {
		return globalConcurrent;
	},
	set globalConcurrent(v: number) {
		globalConcurrent = v;
	},
	get globalPausedUntil() {
		return globalPausedUntil;
	},
	set globalPausedUntil(v: number) {
		globalPausedUntil = v;
	},
	endpointTimestamps,
	concurrencyWaiters,
	ENDPOINT_LIMITS,
	MAX_GLOBAL_CONCURRENT,
	DEFAULT_RETRY_AFTER_MS,
	resetState() {
		globalConcurrent = 0;
		globalPausedUntil = 0;
		for (const key of Object.keys(endpointTimestamps)) delete endpointTimestamps[key];
		concurrencyWaiters.length = 0;
	},
};
