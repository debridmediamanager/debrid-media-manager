import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import getConfig from 'next/config';
import qs from 'qs';
import {
	AccessTokenResponse,
	AddMagnetResponse,
	CredentialsResponse,
	DeviceCodeResponse,
	RdInstantAvailabilityResponse,
	TorrentInfoResponse,
	UnrestrictResponse,
	UserResponse,
	UserTorrentResponse,
	UserTorrentsResult,
} from './types';

const { publicRuntimeConfig: config } = getConfig();

// Constants for timeout and retry
const REQUEST_TIMEOUT = 10000; // Increased from 5s to 10s
const TORRENT_REQUEST_TIMEOUT = 30000; // Increased from 15s to 30s
// Adjust rate limits to be compatible with the service worker cache timing
// Service worker cache is 5 seconds, so we need to ensure requests are spaced
// to avoid conflicting with cache invalidation
const MIN_REQUEST_INTERVAL = (60 * 1000) / 250; // 240ms between requests
const CACHE_BACKOFF_TIME = 6000; // Slightly longer than the service worker cache (5s)

// Add a cache-aware ID generator to ensure unique cache entries for retries
// This prevents retry requests from hitting stale cached errors
let requestCount = 0;
function getUniqueRequestId() {
	return `req-${Date.now()}-${requestCount++}`;
}

// Function to replace #num# with random number 0-9
function getProxyUrl(baseUrl: string): string {
	return baseUrl.replace('#num#', Math.floor(Math.random() * 10).toString());
}

// Validate SHA40 hash format
function isValidSHA40Hash(hash: string): boolean {
	const hashRegex = /^[a-f0-9]{40}$/i;
	return hashRegex.test(hash);
}

// Extend the Axios request config type to include our custom property
interface ExtendedAxiosRequestConfig extends InternalAxiosRequestConfig {
	__isRetryRequest?: boolean;
}

// Function to create an Axios client with a given token
function createAxiosClient(token: string, timeout: number = REQUEST_TIMEOUT): AxiosInstance {
	const client = axios.create({
		headers: {
			Authorization: `Bearer ${token}`,
		},
		timeout: timeout, // Use the provided timeout value
	});

	// Rate limiting configuration
	let lastRequestTime = 0;

	// Add request interceptor for rate limiting
	client.interceptors.request.use(async (config: ExtendedAxiosRequestConfig) => {
		const now = Date.now();
		const timeSinceLastRequest = now - lastRequestTime;
		if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
			await new Promise((resolve) =>
				setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest)
			);
		}

		// Add cache-busting parameter for retries to prevent hitting cached errors
		if (config.__isRetryRequest) {
			// Add a unique ID to the URL to bypass service worker cache for retries
			const separator = config.url?.includes('?') ? '&' : '?';
			config.url = `${config.url}${separator}_cache_buster=${getUniqueRequestId()}`;
		}

		lastRequestTime = Date.now();
		return config;
	});

	// Add response interceptor for handling all retries (including timeouts and 429 errors)
	client.interceptors.response.use(
		(response) => response,
		async (error) => {
			let retryCount = 0;
			const originalConfig = error.config as ExtendedAxiosRequestConfig;

			// If config doesn't exist or the retry counter exceeds limit, reject
			if (!originalConfig || retryCount > 5) {
				return Promise.reject(error);
			}

			// Set flag to avoid infinite retry loops
			originalConfig.__isRetryRequest = true;

			// Determine if we should retry
			const shouldRetry = () => {
				// Network error codes that should trigger retry
				const retryableNetworkErrors = [
					'ECONNABORTED', // axios timeout
					'ECONNRESET', // connection reset by peer
					'ECONNREFUSED', // connection refused
					'ENETUNREACH', // network unreachable
					'EHOSTUNREACH', // host unreachable
					'EAI_AGAIN', // temporary failure in name resolution
				];

				// Retry on specific error codes
				const isRetryableNetworkError = retryableNetworkErrors.includes(error.code);

				// Retry on timeout errors (in case error.code isn't set but message indicates timeout)
				const isTimeout =
					!isRetryableNetworkError && error.message && error.message.includes('timeout');

				// Retry on 429 rate limit errors
				const isRateLimit = error.response?.status === 429;

				// Retry on network errors without specific code
				const isGenericNetworkError = !error.response && !isRetryableNetworkError;

				// Retry on specific 5xx server errors
				const isServerError = error.response?.status >= 500 && error.response?.status < 600;

				return (
					isRetryableNetworkError ||
					isTimeout ||
					isRateLimit ||
					isGenericNetworkError ||
					isServerError
				);
			};

			// Retry logic with improved awareness of service worker cache
			while (shouldRetry() && retryCount < 5) {
				retryCount++;

				// For 429 errors, use exponential backoff
				let delay = CACHE_BACKOFF_TIME; // Default wait longer than cache TTL
				if (error.response?.status === 429) {
					delay = Math.max(
						CACHE_BACKOFF_TIME,
						Math.min(Math.pow(2, retryCount) * 1000, 30000)
					); // Max 30s, min greater than cache TTL
				}

				console.log(
					`Request failed (${error.message}). Retrying (attempt #${retryCount}) after ${delay}ms delay...`
				);

				await new Promise((resolve) => setTimeout(resolve, delay));

				try {
					return await client.request(originalConfig);
				} catch (retryError) {
					error = retryError;
				}
			}

			return Promise.reject(error);
		}
	);

	return client;
}

// Create a generic axios instance for non-authenticated requests
const genericAxios = axios.create({
	timeout: REQUEST_TIMEOUT,
});

// Function to get a configured generic axios instance with custom timeout
function getGenericAxios(timeout: number = REQUEST_TIMEOUT) {
	if (timeout === REQUEST_TIMEOUT) {
		return genericAxios;
	}

	return axios.create({
		timeout: timeout,
	});
}

// Apply same retry logic to the generic axios instance
genericAxios.interceptors.response.use(
	(response) => response,
	async (error) => {
		let retryCount = 0;
		const originalConfig = error.config as ExtendedAxiosRequestConfig;

		// If config doesn't exist or the retry counter exceeds limit, reject
		if (!originalConfig || retryCount > 5) {
			return Promise.reject(error);
		}

		originalConfig.__isRetryRequest = true;

		const shouldRetry = () => {
			// Network error codes that should trigger retry
			const retryableNetworkErrors = [
				'ECONNABORTED', // axios timeout
				'ECONNRESET', // connection reset by peer
				'ECONNREFUSED', // connection refused
				'ENETUNREACH', // network unreachable
				'EHOSTUNREACH', // host unreachable
				'EAI_AGAIN', // temporary failure in name resolution
			];

			// Retry on specific error codes
			const isRetryableNetworkError = retryableNetworkErrors.includes(error.code);

			// Retry on timeout errors (in case error.code isn't set but message indicates timeout)
			const isTimeout =
				!isRetryableNetworkError && error.message && error.message.includes('timeout');

			// Retry on 429 rate limit errors
			const isRateLimit = error.response?.status === 429;

			// Retry on network errors without specific code
			const isGenericNetworkError = !error.response && !isRetryableNetworkError;

			// Retry on specific 5xx server errors
			const isServerError = error.response?.status >= 500 && error.response?.status < 600;

			return (
				isRetryableNetworkError ||
				isTimeout ||
				isRateLimit ||
				isGenericNetworkError ||
				isServerError
			);
		};

		// Retry logic with improved awareness of service worker cache
		while (shouldRetry() && retryCount < 5) {
			retryCount++;

			// For 429 errors, use exponential backoff
			let delay = CACHE_BACKOFF_TIME; // Default wait longer than cache TTL
			if (error.response?.status === 429) {
				delay = Math.max(
					CACHE_BACKOFF_TIME,
					Math.min(Math.pow(2, retryCount) * 1000, 30000)
				); // Max 30s, min greater than cache TTL
			}

			console.log(
				`Request failed (${error.message}). Retrying (attempt #${retryCount}) after ${delay}ms delay...`
			);

			await new Promise((resolve) => setTimeout(resolve, delay));

			try {
				// Add cache-busting parameter for retries
				if (originalConfig.url) {
					const separator = originalConfig.url.includes('?') ? '&' : '?';
					originalConfig.url = `${originalConfig.url}${separator}_cache_buster=${getUniqueRequestId()}`;
				}
				return await genericAxios.request(originalConfig);
			} catch (retryError) {
				error = retryError;
			}
		}

		return Promise.reject(error);
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
			`${bare ? 'https://api.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/oauth/v2/token`,
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
			const client = await createAxiosClient(accessToken);
			const response = await client.get<UserResponse>(
				`${getProxyUrl(config.proxy)}${config.realDebridHostname}/rest/1.0/user`
			);
			return response.data;
		} catch (error: any) {
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
	try {
		const client = await createAxiosClient(accessToken, TORRENT_REQUEST_TIMEOUT);

		// Add a cache-aware parameter to ensure fresh results for critical requests
		// This helps avoid conflicts with the service worker cache
		const cacheParam = page === 1 ? `&_fresh=${Date.now()}` : '';

		const response = await client.get<UserTorrentResponse[]>(
			`${bare ? 'https://api.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/rest/1.0/torrents?page=${page}&limit=${limit}${cacheParam}`
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
		const client = await createAxiosClient(accessToken);
		const response = await client.get<TorrentInfoResponse>(
			`${bare ? 'https://api.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/rest/1.0/torrents/info/${id}`
		);
		return response.data;
	} catch (error: any) {
		console.error('Error fetching torrent information:', error.message);
		throw error;
	}
};

export const rdInstantCheck = async (
	accessToken: string,
	hashes: string[]
): Promise<RdInstantAvailabilityResponse> => {
	try {
		// Filter out invalid hashes
		const validHashes = hashes.filter((hash) => isValidSHA40Hash(hash));

		if (validHashes.length === 0) {
			return {}; // Return empty response if no valid hashes
		}

		const client = await createAxiosClient(accessToken);
		const response = await client.get<RdInstantAvailabilityResponse>(
			`${getProxyUrl(config.proxy)}${config.realDebridHostname}/rest/1.0/torrents/instantAvailability/${validHashes.join('/')}`
		);
		return response.data;
	} catch (error: any) {
		console.error('Error fetching torrent information:', error.message);
		throw error;
	}
};

export const addMagnet = async (
	accessToken: string,
	magnet: string,
	bare: boolean = false
): Promise<string> => {
	try {
		const client = await createAxiosClient(accessToken);
		const response = await client.post<AddMagnetResponse>(
			`${bare ? 'https://api.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/rest/1.0/torrents/addMagnet`,
			qs.stringify({ magnet }),
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
			}
		);
		if (response.status !== 201) {
			throw new Error('Failed to add magnet, status: ' + response.status);
		}
		return response.data.id;
	} catch (error: any) {
		console.error('Error adding magnet:', error.message);
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

	return await addMagnet(accessToken, `magnet:?xt=urn:btih:${hash}`, bare);
};

export const selectFiles = async (
	accessToken: string,
	id: string,
	files: string[],
	bare: boolean = false
): Promise<void> => {
	try {
		const client = await createAxiosClient(accessToken);
		const response = await client.post(
			`${bare ? 'https://api.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/rest/1.0/torrents/selectFiles/${id}`,
			qs.stringify({ files: files.join(',') }),
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
			}
		);
	} catch (error: any) {
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
		const client = await createAxiosClient(accessToken);
		await client.delete(
			`${bare ? 'https://api.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/rest/1.0/torrents/delete/${id}`
		);
	} catch (error: any) {
		console.error('Error deleting torrent:', error.message);
		throw error;
	}
};

export const deleteDownload = async (accessToken: string, id: string): Promise<void> => {
	try {
		const client = await createAxiosClient(accessToken);
		await client.delete(
			`${getProxyUrl(config.proxy)}${config.realDebridHostname}/rest/1.0/downloads/delete/${id}`
		);
	} catch (error: any) {
		console.error('Error deleting download:', error.message);
		throw error;
	}
};

export const unrestrictLink = async (
	accessToken: string,
	link: string,
	ipAddress: string,
	bare: boolean = false
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
		params.append('link', link);

		const client = await createAxiosClient(accessToken);
		const response = await client.post<UnrestrictResponse>(
			`${bare ? 'https://api.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/rest/1.0/unrestrict/link`,
			params.toString(),
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
			}
		);
		return response.data;
	} catch (error: any) {
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

		return response.data;
	} catch (error: any) {
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
