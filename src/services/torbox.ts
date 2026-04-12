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
const MIN_REQUEST_INTERVAL = (60 * 1000) / 250; // 240ms between requests (matching RealDebrid)
const BASE_URL = 'https://api.torbox.app';
const API_VERSION = 'v1';

// Global rate limiter for all TorBox API requests
let globalRequestQueue: Promise<void> = Promise.resolve();
let globalLastRequestTime = 0;

// Custom error class for rate limiting
export class TorBoxRateLimitError extends Error {
	constructor(message: string = 'TorBox API rate limit exceeded. Please wait and try again.') {
		super(message);
		this.name = 'TorBoxRateLimitError';
	}
}

// Delay function using MessageChannel to avoid browser throttling in background tabs
function delayWithMessageChannel(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Shared rate limiting function that serializes all requests
async function enforceRateLimit(): Promise<void> {
	globalRequestQueue = globalRequestQueue.then(async () => {
		const now = Date.now();
		const timeSinceLastRequest = now - globalLastRequestTime;

		if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
			await delayWithMessageChannel(MIN_REQUEST_INTERVAL - timeSinceLastRequest);
		}

		globalLastRequestTime = Date.now();
	});

	await globalRequestQueue;
}

// Add a cache-aware ID generator to ensure unique cache entries for retries
let requestCount = 0;
function getUniqueRequestId() {
	return `req-${Date.now()}-${requestCount++}`;
}

// Extend the Axios request config type to include our custom properties
interface ExtendedAxiosRequestConfig extends InternalAxiosRequestConfig {
	__isRetryRequest?: boolean;
	__retryCount?: number;
	__torboxToken?: string;
}

// Helper function to calculate exponential backoff delay with jitter
function calculateRetryDelay(retryCount: number): number {
	// Base delay: 1s, doubled each attempt (1s, 2s, 4s, 8s, 16s)
	const baseDelay = Math.pow(2, retryCount - 1) * 1000;

	// Cap at 60s first
	const cappedDelay = Math.min(baseDelay, 60000);

	// Add ±20% jitter to prevent thundering herd
	const jitterFactor = 0.8 + Math.random() * 0.4;
	const delayWithJitter = cappedDelay * jitterFactor;

	return delayWithJitter;
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

// Add request interceptor for rate limiting and cache busting
torBoxAxios.interceptors.request.use(async (config: ExtendedAxiosRequestConfig) => {
	await enforceRateLimit();

	// Add cache-busting parameter for retries to prevent hitting cached errors
	if (config.__isRetryRequest && config.url) {
		const url = new URL(config.url, 'http://dummy-base.com');
		url.searchParams.set('_cache_buster', getUniqueRequestId());
		config.url = config.url.startsWith('http') ? url.toString() : url.pathname + url.search;
	}

	return config;
});

// Add response interceptor for handling retries with exponential backoff
torBoxAxios.interceptors.response.use(
	(response) => response,
	async (error) => {
		const originalConfig = error.config as ExtendedAxiosRequestConfig;

		if (!originalConfig) {
			return Promise.reject(error);
		}

		if (originalConfig.__retryCount === undefined) {
			originalConfig.__retryCount = 0;
		}

		// Max 7 retries (matching RealDebrid)
		if (originalConfig.__retryCount >= 7) {
			// If we exhausted retries due to rate limiting, throw a specific error
			if (error.response?.status === 429) {
				return Promise.reject(new TorBoxRateLimitError());
			}
			return Promise.reject(error);
		}

		// Retry on 5xx server errors OR 429 rate limit errors
		const status = error.response?.status;
		const shouldRetry = (status >= 500 && status < 600) || status === 429;

		if (!shouldRetry) {
			return Promise.reject(error);
		}

		originalConfig.__retryCount++;
		originalConfig.__isRetryRequest = true;

		const delay = calculateRetryDelay(originalConfig.__retryCount);

		const errorType = error.response?.status === 429 ? 'rate limit' : 'server';
		console.log(
			`TorBox API request failed with ${error.response?.status} ${errorType} error. Retrying (attempt ${originalConfig.__retryCount}/7) after ${Math.round(delay)}ms delay...`
		);

		await delayWithMessageChannel(delay);

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
	}
): Promise<TorBoxResponse<string>> => {
	const response = await torBoxAxios.get<TorBoxResponse<string>>(
		`${getTorBoxBaseUrl()}/${API_VERSION}/api/torrents/requestdl`,
		{
			params: {
				token: accessToken,
				...params,
			},
			...getAxiosConfig(accessToken),
		}
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
