import { recordRdOperationEvent } from '@/lib/observability/rdOperationalStats';
import axios, { InternalAxiosRequestConfig } from 'axios';
import getConfig from 'next/config';
import qs from 'qs';
import {
	AccessTokenResponse,
	CredentialsResponse,
	DeviceCodeResponse,
	TorrentInfoResponse,
	UnrestrictResponse,
	UserResponse,
	UserTorrentResponse,
	UserTorrentsResult,
} from './types';

// Safely access Next.js runtime config in test/non-Next environments
const fallbackRuntimeConfig = {
	proxy: '',
	realDebridHostname: 'https://app.real-debrid.com',
	realDebridClientId: 'X245A4XAIBGVM',
};

const config = (() => {
	try {
		const cfg = (getConfig as any)?.();
		return cfg?.publicRuntimeConfig ?? fallbackRuntimeConfig;
	} catch {
		return fallbackRuntimeConfig;
	}
})();

// Constants for timeout and retry
const REQUEST_TIMEOUT = 10000; // Increased from 5s to 10s
const TORRENT_REQUEST_TIMEOUT = 60000; // 60s timeout for slow connections
// Adjust rate limits to be compatible with the service worker cache timing
// Service worker cache is 5 seconds, so we need to ensure requests are spaced
// to avoid conflicting with cache invalidation
const MIN_REQUEST_INTERVAL = (60 * 1000) / 250; // 240ms between requests
const CACHE_BACKOFF_TIME = 6000; // Slightly longer than the service worker cache (5s)

// Global rate limiter for all RealDebrid API requests
// This implementation uses a Promise chain to serialize all requests and ensure
// a minimum 240ms delay between ANY RealDebrid API call, preventing 429 errors
let globalRequestQueue: Promise<void> = Promise.resolve();
let globalLastRequestTime = 0;

// Delay function using MessageChannel to avoid browser throttling in background tabs
// Unlike setTimeout which gets throttled to 1s+ in inactive tabs, MessageChannel
// uses the browser's message queue which maintains timing accuracy
function delayWithMessageChannel(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Shared rate limiting function that serializes all requests
async function enforceRateLimit(): Promise<void> {
	// Chain onto the global queue to ensure serialization
	globalRequestQueue = globalRequestQueue.then(async () => {
		const now = Date.now();
		const timeSinceLastRequest = now - globalLastRequestTime;

		if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
			await delayWithMessageChannel(MIN_REQUEST_INTERVAL - timeSinceLastRequest);
		}

		globalLastRequestTime = Date.now();
	});

	// Wait for our turn in the queue
	await globalRequestQueue;
}

// Add a cache-aware ID generator to ensure unique cache entries for retries
// This prevents retry requests from hitting stale cached errors
let requestCount = 0;
function getUniqueRequestId() {
	return `req-${Date.now()}-${requestCount++}`;
}

function getProxyUrl(baseUrl: string): string {
	return baseUrl;
}

// Validate SHA40 hash format
function isValidSHA40Hash(hash: string): boolean {
	const hashRegex = /^[a-f0-9]{40}$/i;
	return hashRegex.test(hash);
}

// Extend the Axios request config type to include our custom properties
interface ExtendedAxiosRequestConfig extends InternalAxiosRequestConfig {
	__isRetryRequest?: boolean;
	__retryCount?: number;
}

// Helper function to calculate exponential backoff delay with jitter
function calculateRetryDelay(retryCount: number): number {
	// Base delay: 1s, doubled each attempt (1s, 2s, 4s, 8s, 16s)
	const baseDelay = Math.pow(2, retryCount - 1) * 1000;

	// Cap at 60s first
	const cappedDelay = Math.min(baseDelay, 60000);

	// Add ±20% jitter to prevent thundering herd
	// Apply jitter AFTER capping so even at 60s we get variation (48s-72s)
	const jitterFactor = 0.8 + Math.random() * 0.4; // Random between 0.8 and 1.2
	const delayWithJitter = cappedDelay * jitterFactor;

	return delayWithJitter;
}

// Create a global axios instance for RealDebrid API requests
const realDebridAxios = axios.create({
	// No default authorization header - will be passed per request
	timeout: REQUEST_TIMEOUT,
});

// Add request interceptor for rate limiting and cache busting
realDebridAxios.interceptors.request.use(async (config: ExtendedAxiosRequestConfig) => {
	// Use global rate limiter
	await enforceRateLimit();

	// Add cache-busting parameter for retries to prevent hitting cached errors
	if (config.__isRetryRequest && config.url) {
		// Parse the URL to properly manage query parameters
		const url = new URL(config.url, 'http://dummy-base.com'); // dummy base for relative URLs
		// Replace any existing cache buster with a new one
		url.searchParams.set('_cache_buster', getUniqueRequestId());
		// Update the config URL, preserving relative vs absolute
		config.url = config.url.startsWith('http') ? url.toString() : url.pathname + url.search;
	}

	return config;
});

// Add response interceptor for handling retries with exponential backoff
realDebridAxios.interceptors.response.use(
	(response) => response,
	async (error) => {
		const originalConfig = error.config as ExtendedAxiosRequestConfig;

		// If config doesn't exist, reject
		if (!originalConfig) {
			return Promise.reject(error);
		}

		// Initialize retry count if not set
		if (originalConfig.__retryCount === undefined) {
			originalConfig.__retryCount = 0;
		}

		// Check if we've exceeded max retries
		if (originalConfig.__retryCount >= 7) {
			return Promise.reject(error);
		}

		// Retry on 5xx server errors OR 429 rate limit errors
		const status = error.response?.status;
		const shouldRetry = (status >= 500 && status < 600) || status === 429;

		if (!shouldRetry) {
			return Promise.reject(error);
		}

		// Increment retry count
		originalConfig.__retryCount++;

		// Set flag to avoid infinite retry loops
		originalConfig.__isRetryRequest = true;

		// Calculate delay with exponential backoff and jitter
		const delay = calculateRetryDelay(originalConfig.__retryCount);

		const errorType = error.response?.status === 429 ? 'rate limit' : 'server';
		console.log(
			`RealDebrid API request failed with ${error.response?.status} ${errorType} error. Retrying (attempt ${originalConfig.__retryCount}/7) after ${Math.round(delay)}ms delay...`
		);

		// Wait for the calculated delay (using MessageChannel to avoid background tab throttling)
		await delayWithMessageChannel(delay);

		try {
			return await realDebridAxios.request(originalConfig);
		} catch (retryError) {
			// Pass along the retry error for the next iteration
			return Promise.reject(retryError);
		}
	}
);

// Create a generic axios instance for non-authenticated requests
const genericAxios = axios.create({
	timeout: REQUEST_TIMEOUT,
});

// Function to get a configured generic axios instance with custom timeout
function getGenericAxios(timeout: number = REQUEST_TIMEOUT) {
	if (timeout === REQUEST_TIMEOUT) {
		return genericAxios;
	}

	const customAxios = axios.create({
		timeout: timeout,
	});

	// Add rate limiting interceptor to custom instance
	customAxios.interceptors.request.use(async (config: ExtendedAxiosRequestConfig) => {
		// Use global rate limiter
		await enforceRateLimit();

		return config;
	});

	// Add retry interceptor with same logic as genericAxios
	customAxios.interceptors.response.use(
		(response) => response,
		async (error) => {
			const originalConfig = error.config as ExtendedAxiosRequestConfig;

			// If config doesn't exist, reject
			if (!originalConfig) {
				return Promise.reject(error);
			}

			// Initialize retry count if not set
			if (originalConfig.__retryCount === undefined) {
				originalConfig.__retryCount = 0;
			}

			// Check if we've exceeded max retries
			if (originalConfig.__retryCount >= 7) {
				return Promise.reject(error);
			}

			// Retry on 5xx server errors OR 429 rate limit errors
			const status = error.response?.status;
			const shouldRetry = (status >= 500 && status < 600) || status === 429;

			if (!shouldRetry) {
				return Promise.reject(error);
			}

			// Increment retry count
			originalConfig.__retryCount++;

			// Set flag to avoid infinite retry loops
			originalConfig.__isRetryRequest = true;

			// Calculate delay with exponential backoff and jitter
			const delay = calculateRetryDelay(originalConfig.__retryCount);

			const errorType = error.response?.status === 429 ? 'rate limit' : 'server';
			console.log(
				`Custom axios request failed with ${error.response?.status} ${errorType} error. Retrying (attempt ${originalConfig.__retryCount}/7) after ${Math.round(delay)}ms delay...`
			);

			// Wait for the calculated delay (using MessageChannel to avoid background tab throttling)
			await delayWithMessageChannel(delay);

			try {
				// Add cache-busting parameter for retries
				if (originalConfig.url) {
					// Parse the URL to properly manage query parameters
					const url = new URL(originalConfig.url, 'http://dummy-base.com'); // dummy base for relative URLs
					// Replace any existing cache buster with a new one
					url.searchParams.set('_cache_buster', getUniqueRequestId());
					// Update the config URL, preserving relative vs absolute
					originalConfig.url = originalConfig.url.startsWith('http')
						? url.toString()
						: url.pathname + url.search;
				}
				return await customAxios.request(originalConfig);
			} catch (retryError) {
				// Pass along the retry error for the next iteration
				return Promise.reject(retryError);
			}
		}
	);

	return customAxios;
}

// Add request interceptor for rate limiting to generic axios
genericAxios.interceptors.request.use(async (config: ExtendedAxiosRequestConfig) => {
	// Use global rate limiter
	await enforceRateLimit();

	return config;
});

// Apply same retry logic to the generic axios instance
genericAxios.interceptors.response.use(
	(response) => response,
	async (error) => {
		const originalConfig = error.config as ExtendedAxiosRequestConfig;

		// If config doesn't exist, reject
		if (!originalConfig) {
			return Promise.reject(error);
		}

		// Initialize retry count if not set
		if (originalConfig.__retryCount === undefined) {
			originalConfig.__retryCount = 0;
		}

		// Check if we've exceeded max retries
		if (originalConfig.__retryCount >= 7) {
			return Promise.reject(error);
		}

		// Retry on 5xx server errors OR 429 rate limit errors
		const status = error.response?.status;
		const shouldRetry = (status >= 500 && status < 600) || status === 429;

		if (!shouldRetry) {
			return Promise.reject(error);
		}

		// Increment retry count
		originalConfig.__retryCount++;

		// Set flag to avoid infinite retry loops
		originalConfig.__isRetryRequest = true;

		// Calculate delay with exponential backoff and jitter
		const delay = calculateRetryDelay(originalConfig.__retryCount);

		const errorType = error.response?.status === 429 ? 'rate limit' : 'server';
		console.log(
			`Generic API request failed with ${error.response?.status} ${errorType} error. Retrying (attempt ${originalConfig.__retryCount}/7) after ${Math.round(delay)}ms delay...`
		);

		// Wait for the calculated delay (using MessageChannel to avoid background tab throttling)
		await delayWithMessageChannel(delay);

		try {
			// Add cache-busting parameter for retries
			if (originalConfig.url) {
				// Parse the URL to properly manage query parameters
				const url = new URL(originalConfig.url, 'http://dummy-base.com'); // dummy base for relative URLs
				// Replace any existing cache buster with a new one
				url.searchParams.set('_cache_buster', getUniqueRequestId());
				// Update the config URL, preserving relative vs absolute
				originalConfig.url = originalConfig.url.startsWith('http')
					? url.toString()
					: url.pathname + url.search;
			}
			return await genericAxios.request(originalConfig);
		} catch (retryError) {
			// Pass along the retry error for the next iteration
			return Promise.reject(retryError);
		}
	}
);

export const getDeviceCode = async () => {
	try {
		const url = `${getProxyUrl(config.proxy)}${config.realDebridHostname}/oauth/v2/device/code?client_id=${config.realDebridClientId}&new_credentials=yes`;
		const response = await genericAxios.get<DeviceCodeResponse>(url);
		return response.data;
	} catch (error: any) {
		console.error('Error fetching device code:', error.message);
		throw error;
	}
};

export const getCredentials = async (deviceCode: string) => {
	try {
		const url = `${getProxyUrl(config.proxy)}${config.realDebridHostname}/oauth/v2/device/credentials?client_id=${config.realDebridClientId}&code=${deviceCode}`;
		const response = await genericAxios.get<CredentialsResponse>(url);
		return response.data;
	} catch (error: any) {
		console.error('Error fetching credentials:', error.message);
		throw error;
	}
};

export const getToken = async (
	clientId: string,
	clientSecret: string,
	refreshToken: string,
	bare: boolean = false
) => {
	try {
		const params = new URLSearchParams();
		params.append('client_id', clientId);
		params.append('client_secret', clientSecret);
		params.append('code', refreshToken);
		params.append('grant_type', 'http://oauth.net/grant_type/device/1.0');

		const response = await genericAxios.post<AccessTokenResponse>(
			`${bare ? 'https://app.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/oauth/v2/token`,
			params.toString(),
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error fetching access token:', error.message);
		throw error;
	}
};

// Simple promise cache to prevent duplicate requests
const userRequestCache = new Map<string, Promise<UserResponse>>();
// Cache for time ISO requests - cache for 10 seconds to prevent duplicate calls
const timeISOCache: { promise: Promise<string> | null; timestamp: number } = {
	promise: null,
	timestamp: 0,
};

export const getCurrentUser = async (accessToken: string) => {
	// Check if we already have a pending request for this token
	const cached = userRequestCache.get(accessToken);
	if (cached) {
		return cached;
	}

	// Create the promise and cache it
	const promise = (async () => {
		try {
			const response = await realDebridAxios.get<UserResponse>(
				`${getProxyUrl(config.proxy)}${config.realDebridHostname}/rest/1.0/user`,
				{
					headers: {
						Authorization: `Bearer ${accessToken}`,
					},
				}
			);
			recordRdOperationEvent('GET /user', response.status);
			return response.data;
		} catch (error: any) {
			const status = axios.isAxiosError(error) ? (error.response?.status ?? 500) : 500;
			recordRdOperationEvent('GET /user', status);
			console.error('Error fetching user information:', error.message);
			throw error;
		} finally {
			// Clean up cache after request completes (success or error)
			setTimeout(() => userRequestCache.delete(accessToken), 100);
		}
	})();

	userRequestCache.set(accessToken, promise);
	return promise;
};

export async function getUserTorrentsList(
	accessToken: string,
	limit: number = 1,
	page: number = 1,
	bare: boolean = false
): Promise<UserTorrentsResult> {
	const apiStart = Date.now();
	try {
		// Add a cache-aware parameter to ensure fresh results for all requests
		// This helps avoid conflicts with the service worker cache
		const cacheParam = `&_fresh=${Date.now()}`;

		const response = await realDebridAxios.get<UserTorrentResponse[]>(
			`${bare ? 'https://app.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/rest/1.0/torrents?page=${page}&limit=${limit}${cacheParam}`,
			{
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
				timeout: TORRENT_REQUEST_TIMEOUT,
			}
		);
		recordRdOperationEvent('GET /torrents', response.status);
		console.log(
			`[${new Date().toISOString()}]     RD API call (page=${page}, limit=${limit}): ${Date.now() - apiStart}ms`
		);

		const {
			data,
			headers: { 'x-total-count': totalCount },
		} = response;

		// Parse the totalCount from the headers
		let totalCountValue: number | null = null;
		if (totalCount) {
			totalCountValue = parseInt(totalCount, 10);
			if (isNaN(totalCountValue)) {
				totalCountValue = null;
			}
		}

		return { data, totalCount: totalCountValue };
	} catch (error: any) {
		const status = axios.isAxiosError(error) ? (error.response?.status ?? 500) : 500;
		recordRdOperationEvent('GET /torrents', status);
		console.error('Error fetching user torrents list:', error.message);
		throw error;
	}
}

export const getTorrentInfo = async (
	accessToken: string,
	id: string,
	bare: boolean = false
): Promise<TorrentInfoResponse> => {
	try {
		const response = await realDebridAxios.get<TorrentInfoResponse>(
			`${bare ? 'https://app.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/rest/1.0/torrents/info/${id}`,
			{
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
			}
		);
		recordRdOperationEvent('GET /torrents/info/{id}', response.status);
		return response.data;
	} catch (error: any) {
		const status = axios.isAxiosError(error) ? (error.response?.status ?? 500) : 500;
		recordRdOperationEvent('GET /torrents/info/{id}', status);
		console.error('Error fetching torrent information:', error.message);
		throw error;
	}
};

export const addHashAsMagnet = async (
	accessToken: string,
	hash: string,
	bare: boolean = false
): Promise<string> => {
	// Skip invalid hashes
	if (!isValidSHA40Hash(hash)) {
		throw new Error(`Invalid SHA40 hash: ${hash}`);
	}

	try {
		const response = await realDebridAxios.post(
			`${bare ? 'https://app.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/rest/1.0/torrents/addMagnet`,
			qs.stringify({ magnet: `magnet:?xt=urn:btih:${hash}` }),
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Authorization: `Bearer ${accessToken}`,
				},
			}
		);
		if (response.status !== 201) {
			recordRdOperationEvent('POST /torrents/addMagnet', response.status);
			throw new Error('Failed to add magnet, status: ' + response.status);
		}
		recordRdOperationEvent('POST /torrents/addMagnet', response.status);
		return response.data.id;
	} catch (error: any) {
		const status = axios.isAxiosError(error) ? (error.response?.status ?? 500) : 500;
		recordRdOperationEvent('POST /torrents/addMagnet', status);
		throw error;
	}
};

export const addTorrentFile = async (
	accessToken: string,
	file: File,
	bare: boolean = false // Use proxy by default
): Promise<string> => {
	const arrayBuffer = await file.arrayBuffer();
	const response = await realDebridAxios.put(
		`${bare ? 'https://app.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/rest/1.0/torrents/addTorrent`,
		arrayBuffer,
		{
			headers: {
				'Content-Type': 'application/octet-stream',
				Authorization: `Bearer ${accessToken}`,
			},
		}
	);
	if (response.status !== 201) {
		throw new Error('Failed to add torrent file, status: ' + response.status);
	}
	return response.data.id;
};

export const selectFiles = async (
	accessToken: string,
	id: string,
	files: string[],
	bare: boolean = false
): Promise<void> => {
	try {
		const response = await realDebridAxios.post(
			`${bare ? 'https://app.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/rest/1.0/torrents/selectFiles/${id}`,
			qs.stringify({ files: files.join(',') }),
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Authorization: `Bearer ${accessToken}`,
				},
			}
		);
		recordRdOperationEvent('POST /torrents/selectFiles/{id}', response.status);
	} catch (error: any) {
		const status = axios.isAxiosError(error) ? (error.response?.status ?? 500) : 500;
		recordRdOperationEvent('POST /torrents/selectFiles/{id}', status);
		console.error('Error selecting files:', error.message);
		throw error;
	}
};

export const deleteTorrent = async (
	accessToken: string,
	id: string,
	bare: boolean = false
): Promise<void> => {
	try {
		const response = await realDebridAxios.delete(
			`${bare ? 'https://app.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/rest/1.0/torrents/delete/${id}`,
			{
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
			}
		);
		recordRdOperationEvent('DELETE /torrents/delete/{id}', response.status);
	} catch (error: any) {
		const status = axios.isAxiosError(error) ? (error.response?.status ?? 500) : 500;
		recordRdOperationEvent('DELETE /torrents/delete/{id}', status);
		console.error('Error deleting torrent:', error.message);
		throw error;
	}
};

// Normalize RD link ID to 13 characters
function normalizeRdLink(link: string): string {
	const match = link.match(/^(https:\/\/real-debrid\.com\/d\/)([A-Z0-9]+)$/i);
	if (match) {
		const [, base, id] = match;
		return base + id.substring(0, 13);
	}
	return link;
}

export const unrestrictLink = async (
	accessToken: string,
	link: string,
	ipAddress: string,
	bare: boolean = false,
	password?: string
): Promise<UnrestrictResponse> => {
	try {
		const params = new URLSearchParams();
		if (
			/^\d/.test(ipAddress) &&
			!ipAddress.startsWith('192.168') &&
			!ipAddress.startsWith('10.') &&
			!ipAddress.startsWith('127.') &&
			!ipAddress.startsWith('169.254')
		) {
			params.append('ip', ipAddress);
		}
		params.append('link', normalizeRdLink(link));
		if (password) {
			params.append('password', password);
		}

		const response = await realDebridAxios.post<UnrestrictResponse>(
			`${bare ? 'https://app.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/rest/1.0/unrestrict/link`,
			params.toString(),
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Authorization: `Bearer ${accessToken}`,
				},
			}
		);
		recordRdOperationEvent('POST /unrestrict/link', response.status);
		return response.data;
	} catch (error: any) {
		const status = axios.isAxiosError(error) ? (error.response?.status ?? 500) : 500;
		recordRdOperationEvent('POST /unrestrict/link', status);
		console.error('Error checking unrestrict:', error.message);
		throw error;
	}
};

export const proxyUnrestrictLink = async (
	accessToken: string,
	link: string
): Promise<UnrestrictResponse> => {
	try {
		const body = JSON.stringify({ link });
		const headers = {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${accessToken}`,
		};

		const response = await genericAxios.post<UnrestrictResponse>(
			`https://unrestrict.debridmediamanager.com/`,
			body,
			{ headers }
		);

		recordRdOperationEvent('POST /unrestrict/link', response.status);
		return response.data;
	} catch (error: any) {
		const status = axios.isAxiosError(error) ? (error.response?.status ?? 500) : 500;
		recordRdOperationEvent('POST /unrestrict/link', status);
		console.error('Error checking unrestrict:', error.message);
		throw error;
	}
};

export const getTimeISO = async (): Promise<string> => {
	const now = Date.now();
	const CACHE_DURATION = 10000; // 10 seconds

	// Check if we have a valid cached response
	if (timeISOCache.promise && now - timeISOCache.timestamp < CACHE_DURATION) {
		return timeISOCache.promise;
	}

	// Create new promise and cache it
	const promise = (async () => {
		try {
			const response = await genericAxios.get<string>(
				`${getProxyUrl(config.proxy)}${config.realDebridHostname}/rest/1.0/time/iso`
			);
			return response.data;
		} catch (error: any) {
			console.error('Error fetching time:', error.message);
			// Clear cache on error so next call will retry
			timeISOCache.promise = null;
			timeISOCache.timestamp = 0;
			throw error;
		}
	})();

	// Update cache
	timeISOCache.promise = promise;
	timeISOCache.timestamp = now;

	return promise;
};

export const __testing = {
	realDebridAxios,
	genericAxios,
	clearUserRequestCache: () => {
		userRequestCache.clear();
	},
	resetTimeISOCache: () => {
		timeISOCache.promise = null;
		timeISOCache.timestamp = 0;
	},
};
