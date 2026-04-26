import { delay as delayWithMessageChannel } from '@/utils/delay';
import axios, { InternalAxiosRequestConfig } from 'axios';
import getConfig from 'next/config';

// Safely access Next.js runtime config in test/non-Next environments
const fallbackRuntimeConfig = {
	allDebridHostname: 'https://api.alldebrid.com',
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
const REQUEST_TIMEOUT = 10000;
const MIN_REQUEST_INTERVAL = (60 * 1000) / 250; // 240ms between requests (matching RealDebrid)

// Global rate limiter for all AllDebrid API requests
let globalRequestQueue: Promise<void> = Promise.resolve();
let globalLastRequestTime = 0;

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

// Create a global axios instance for AllDebrid API requests
const allDebridAxios = axios.create({
	timeout: REQUEST_TIMEOUT,
});

// Add request interceptor for rate limiting and cache busting
allDebridAxios.interceptors.request.use(async (config: ExtendedAxiosRequestConfig) => {
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
allDebridAxios.interceptors.response.use(
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
			`AllDebrid API request failed with ${error.response?.status} ${errorType} error. Retrying (attempt ${originalConfig.__retryCount}/7) after ${Math.round(delay)}ms delay...`
		);

		await delayWithMessageChannel(delay);

		try {
			return await allDebridAxios.request(originalConfig);
		} catch (retryError) {
			return Promise.reject(retryError);
		}
	}
);

// API Response wrapper
interface ApiResponse<T> {
	status: 'success' | 'error';
	data?: T;
	error?: {
		code: string;
		message: string;
	};
}

// Pin interfaces
interface PinData {
	pin: string;
	check: string;
	expires_in: number;
	user_url: string;
	base_url: string;
	check_url?: string; // For backward compatibility
}

interface PinCheckData {
	activated: boolean;
	expires_in: number;
	apikey?: string;
}

// User interfaces
interface UserData {
	user: {
		username: string;
		email: string;
		isPremium: boolean;
		isSubscribed: boolean;
		isTrial: boolean;
		premiumUntil: number;
		lang: string;
		preferedDomain: string;
		fidelityPoints: number;
		limitedHostersQuotas: Record<string, number>;
		remainingTrialQuota?: number;
		notifications: string[];
	};
}

// Magnet interfaces
interface MagnetObject {
	magnet: string;
	name?: string;
	id?: number;
	hash?: string;
	size?: number;
	ready?: boolean;
	error?: {
		code: string;
		message: string;
	};
}

interface MagnetUploadData {
	magnets: MagnetObject[];
}

// For backward compatibility with existing code
interface LinkObject {
	link: string;
	filename: string;
	size: number;
	files: { n: string; s?: number }[];
}

export interface MagnetStatus {
	id: number;
	filename: string;
	size: number;
	hash?: string;
	status: string;
	statusCode: number;
	downloaded?: number;
	uploaded?: number;
	processingPerc?: number;
	seeders?: number;
	downloadSpeed?: number;
	uploadSpeed?: number;
	uploadDate?: number;
	completionDate?: number;
	links: LinkObject[]; // For backward compatibility
	type?: string;
	notified?: boolean;
	version?: number;
	files?: MagnetFile[]; // v4.1 structure
}

interface MagnetStatusData {
	magnets: MagnetStatus[];
	counter?: number;
	fullsync?: boolean;
}

export interface MagnetFile {
	n: string; // name
	s?: number; // size
	l?: string; // link
	e?: MagnetFile[]; // sub-entries (folders)
}

interface MagnetFilesData {
	magnets: Array<{
		id: string;
		files?: MagnetFile[];
		error?: {
			code: string;
			message: string;
		};
	}>;
}

interface MagnetDeleteData {
	message: string;
}

interface MagnetRestartData {
	message?: string;
	magnets?: Array<{
		magnet: string;
		message?: string;
		error?: {
			code: string;
			message: string;
		};
	}>;
}

interface MagnetInstantData {
	data: {
		magnets: Array<{
			magnet: string;
			hash: string;
			instant: boolean;
			files?: MagnetFile[];
			error?: {
				code: string;
				message: string;
			};
		}>;
	};
}

// Response type to maintain backward compatibility
interface MagnetStatusResponse {
	status: string;
	data: {
		magnets: MagnetStatus[];
	};
}

// Public endpoints (no auth required)
export const getPin = async (): Promise<PinData> => {
	try {
		const endpoint = `${config.allDebridHostname}/v4.1/pin/get`;
		const response = await allDebridAxios.get<ApiResponse<PinData>>(endpoint);

		if (response.data.status === 'error') {
			throw new Error(response.data.error?.message || 'Unknown error');
		}

		return response.data.data!;
	} catch (error) {
		console.error('Error fetching PIN:', (error as any).message);
		throw error;
	}
};

export const checkPin = async (pin: string, check: string): Promise<PinCheckData> => {
	const endpoint = `${config.allDebridHostname}/v4.1/pin/check`;
	try {
		const params = new URLSearchParams();
		params.append('pin', pin);
		params.append('check', check);

		let pinCheck = await allDebridAxios.post<ApiResponse<PinCheckData>>(endpoint, params, {
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
		});

		if (pinCheck.data.status === 'error') {
			throw new Error(pinCheck.data.error?.message || 'Unknown error');
		}

		while (!pinCheck.data.data!.activated) {
			await delayWithMessageChannel(5000);
			pinCheck = await allDebridAxios.post<ApiResponse<PinCheckData>>(endpoint, params, {
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
			});

			if (pinCheck.data.status === 'error') {
				throw new Error(pinCheck.data.error?.message || 'Unknown error');
			}
		}

		// Return in old format for backward compatibility
		return pinCheck.data.data!;
	} catch (error) {
		console.error('Error checking PIN:', (error as any).message);
		throw error;
	}
};

// Authenticated endpoints
export const getAllDebridUser = async (apikey: string) => {
	const endpoint = `${config.allDebridHostname}/v4.1/user`;
	try {
		const response = await allDebridAxios.get<ApiResponse<UserData>>(endpoint, {
			headers: { Authorization: `Bearer ${apikey}` },
		});

		if (response.data.status === 'error') {
			throw new Error(response.data.error?.message || 'Unknown error');
		}

		return response.data.data!.user;
	} catch (error) {
		console.error('Error fetching user info:', (error as any).message);
		throw error;
	}
};

export const uploadMagnet = async (apikey: string, hashes: string[]): Promise<MagnetUploadData> => {
	try {
		const endpoint = `${config.allDebridHostname}/v4.1/magnet/upload`;

		// Convert hashes to magnets (handles both formats)
		const magnets = hashes
			.map((h) => (h.startsWith('magnet:?') ? h : `magnet:?xt=urn:btih:${h}`))
			.filter((m) => m.startsWith('magnet:?'));

		if (!magnets.length) {
			throw new Error('No valid magnets to upload');
		}

		// AllDebrid expects x-www-form-urlencoded with repeated magnets[] fields
		const params = new URLSearchParams();
		magnets.forEach((m) => params.append('magnets[]', m));

		const response = await allDebridAxios.post<ApiResponse<MagnetUploadData>>(
			endpoint,
			params,
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Authorization: `Bearer ${apikey}`,
				},
			}
		);

		if (response.data.status === 'error') {
			throw new Error(response.data.error?.message || 'Unknown error');
		}

		return response.data.data!;
	} catch (error) {
		console.error('Error uploading magnet:', (error as any).message);
		throw error;
	}
};

// Helper function to convert MagnetFile structure to LinkObject for backward compatibility
function convertFilesToLinks(files?: MagnetFile[]): LinkObject[] {
	if (!files || files.length === 0) return [];

	const links: LinkObject[] = [];

	function processFile(file: MagnetFile, parentPath: string = ''): void {
		const fullPath = parentPath ? `${parentPath}/${file.n}` : file.n;

		if (file.l) {
			// It's a file with a link
			links.push({
				link: file.l,
				filename: fullPath,
				size: file.s || 0,
				files: [],
			});
		} else if (file.e) {
			// It's a folder with sub-entries
			file.e.forEach((subFile) => processFile(subFile, fullPath));
		}
	}

	files.forEach((file) => processFile(file));
	return links;
}

export const getMagnetStatus = async (
	apikey: string,
	magnetId?: string,
	statusFilter?: string,
	session?: number,
	counter?: number
): Promise<MagnetStatusResponse> => {
	const endpoint = `${config.allDebridHostname}/v4.1/magnet/status`;

	// Use URLSearchParams for form-urlencoded as required by AllDebrid API
	const params = new URLSearchParams();
	params.append('_fresh', Date.now().toString()); // Add cache-busting parameter for fresh uncached results

	const requestMeta = {
		hasMagnetId: Boolean(magnetId),
		hasStatusFilter: Boolean(statusFilter),
		session,
		counter,
	};
	const requestStartedAt = Date.now();
	console.log('[AllDebridAPI] getMagnetStatus start', requestMeta);

	if (magnetId) {
		params.append('id', magnetId);
	} else if (statusFilter) {
		params.append('status', statusFilter);
	}

	if (session !== undefined) {
		params.append('session', session.toString());
	}

	if (counter !== undefined) {
		params.append('counter', counter.toString());
	}

	try {
		const response = await allDebridAxios.post<ApiResponse<MagnetStatusData>>(
			endpoint,
			params,
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Authorization: `Bearer ${apikey}`,
				},
			}
		);

		if (response.data.status === 'error') {
			throw new Error(response.data.error?.message || 'Unknown error');
		}

		// v4.1 status endpoint includes files in the response
		const magnets = response.data.data!.magnets;
		const durationMs = Date.now() - requestStartedAt;
		console.log('[AllDebridAPI] getMagnetStatus success', {
			...requestMeta,
			magnetCount: magnets.length,
			fullSync: Boolean(response.data.data?.fullsync),
			elapsedMs: durationMs,
		});

		// Convert files to links for backward compatibility
		magnets.forEach((m) => {
			// Initialize links array
			if (!m.links) m.links = [];

			// If magnet has files (v4.1 includes them), convert to links format
			if (m.files && m.files.length > 0) {
				m.links = convertFilesToLinks(m.files);
			}
		});

		// Return in old format for backward compatibility
		return {
			status: response.data.status,
			data: {
				magnets: magnets,
			},
		};
	} catch (error) {
		console.error(
			'[AllDebridAPI] getMagnetStatus error after',
			Date.now() - requestStartedAt,
			'ms',
			{
				...requestMeta,
				error: (error as any)?.message,
			}
		);
		console.error('Error fetching magnet status:', (error as any).message);
		throw error;
	}
};

export const getMagnetFiles = async (
	apikey: string,
	magnetIds: number[]
): Promise<MagnetFilesData> => {
	const endpoint = `${config.allDebridHostname}/v4.1/magnet/files`;

	// Filter out invalid IDs before making the request
	const validIds = magnetIds.filter((id) => id && id > 0);

	if (validIds.length === 0) {
		return { magnets: [] } as MagnetFilesData;
	}

	try {
		// AllDebrid expects form-encoded data with repeated id[] fields
		const params = new URLSearchParams();
		validIds.forEach((id) => params.append('id[]', id.toString()));

		const response = await allDebridAxios.post<ApiResponse<MagnetFilesData>>(endpoint, params, {
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Authorization: `Bearer ${apikey}`,
			},
		});

		if (response.data.status === 'error') {
			throw new Error(response.data.error?.message || 'Unknown error');
		}

		return response.data.data!;
	} catch (error: any) {
		// Only log error if it's not about invalid magnet IDs
		if (!error?.message?.includes('magnet ID does not exists')) {
			console.error('Error fetching magnet files:', error.message);
		}
		throw error;
	}
};

export const deleteMagnet = async (apikey: string, id: string): Promise<MagnetDeleteData> => {
	const endpoint = `${config.allDebridHostname}/v4.1/magnet/delete`;
	try {
		// AllDebrid expects form-encoded data
		const params = new URLSearchParams();
		params.append('id', id);

		const response = await allDebridAxios.post<ApiResponse<MagnetDeleteData>>(
			endpoint,
			params,
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Authorization: `Bearer ${apikey}`,
				},
			}
		);

		if (response.data.status === 'error') {
			throw new Error(response.data.error?.message || 'Unknown error');
		}

		return response.data.data!;
	} catch (error) {
		console.error('Error deleting magnet:', (error as any).message);
		throw error;
	}
};

export const restartMagnet = async (apikey: string, id: string): Promise<MagnetRestartData> => {
	const endpoint = `${config.allDebridHostname}/v4.1/magnet/restart`;
	try {
		// AllDebrid expects form-encoded data
		const params = new URLSearchParams();
		params.append('id', id);

		const response = await allDebridAxios.post<ApiResponse<MagnetRestartData>>(
			endpoint,
			params,
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Authorization: `Bearer ${apikey}`,
				},
			}
		);

		if (!response.data || response.data.status === 'error') {
			throw new Error(response.data?.error?.message || 'Unknown error');
		}

		return response.data.data!;
	} catch (error) {
		console.error('Error restarting magnet:', (error as any).message);
		throw error;
	}
};

// Note: /v4.1/magnet/instant is not documented in the official API; this may be a custom or undocumented endpoint
export const adInstantCheck = async (
	apikey: string,
	hashes: string[]
): Promise<MagnetInstantData> => {
	const endpoint = `${config.allDebridHostname}/v4.1/magnet/instant`;
	try {
		const response = await allDebridAxios.get<MagnetInstantData>(endpoint, {
			headers: { Authorization: `Bearer ${apikey}` },
			params: { magnets: hashes },
		});

		return response.data;
	} catch (error: any) {
		console.error('Error fetching magnet availability:', error.message);
		throw error;
	}
};

// ====================================================================
// Availability Checking Functions (Simplified for availability checks)
// ====================================================================

/**
 * Upload a single magnet hash for availability checking
 * Simplified version of uploadMagnet for single hash use case
 * Returns the upload result with 'ready' field indicating instant availability
 */
export const uploadMagnetAd = async (apiKey: string, hash: string): Promise<MagnetObject> => {
	const hashRegex = /^[a-f0-9]{40}$/i;
	if (!hashRegex.test(hash)) {
		throw new Error(`Invalid SHA40 hash: ${hash}`);
	}

	const endpoint = `${config.allDebridHostname}/v4.1/magnet/upload`;
	const params = new URLSearchParams();
	params.append('magnets[]', `magnet:?xt=urn:btih:${hash}`);

	try {
		const response = await allDebridAxios.post<ApiResponse<MagnetUploadData>>(
			endpoint,
			params,
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Authorization: `Bearer ${apiKey}`,
				},
			}
		);

		if (response.data.status === 'error') {
			throw new Error(response.data.error?.message || 'Upload failed');
		}

		return response.data.data!.magnets[0];
	} catch (error: any) {
		console.error('Error uploading magnet for availability check:', error.message);
		throw error;
	}
};

/**
 * Get magnet status including files for a specific magnet ID
 * Simplified version of getMagnetStatus for single magnet queries
 * Returns status with files array (no need for separate /files call)
 */
export const getMagnetStatusAd = async (
	apiKey: string,
	magnetId: number
): Promise<MagnetStatus> => {
	const endpoint = `${config.allDebridHostname}/v4.1/magnet/status`;
	const params = new URLSearchParams();
	params.append('id', magnetId.toString());

	try {
		const response = await allDebridAxios.post<ApiResponse<{ magnets: MagnetStatus }>>(
			endpoint,
			params,
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Authorization: `Bearer ${apiKey}`,
				},
			}
		);

		if (response.data.status === 'error') {
			throw new Error(response.data.error?.message || 'Status check failed');
		}

		// Note: Status endpoint returns magnets as OBJECT (not array) when querying by ID
		return response.data.data!.magnets;
	} catch (error: any) {
		console.error('Error fetching magnet status:', error.message);
		throw error;
	}
};

/**
 * Delete a magnet by ID
 * Simplified wrapper around deleteMagnet for consistency with other AD availability functions
 * Uses axios interceptor for retry logic on 429/5xx errors
 */
export const deleteMagnetAd = async (apiKey: string, magnetId: number): Promise<void> => {
	const endpoint = `${config.allDebridHostname}/v4.1/magnet/delete`;
	const params = new URLSearchParams();
	params.append('id', magnetId.toString());

	try {
		const response = await allDebridAxios.post<ApiResponse<MagnetDeleteData>>(
			endpoint,
			params,
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Authorization: `Bearer ${apiKey}`,
				},
			}
		);

		if (response.data.status === 'error') {
			throw new Error(response.data.error?.message || 'Delete failed');
		}
	} catch (error: any) {
		console.error('Error deleting magnet:', error.message);
		throw error;
	}
};

// ====================================================================
// Helper Functions
// ====================================================================

/**
 * Check if a magnet upload indicates instant availability
 * @param upload Upload response from uploadMagnetAd
 * @returns true if the magnet is instantly available (cached)
 */
export function isAdMagnetInstant(upload: MagnetObject): boolean {
	return upload.ready === true;
}

/**
 * Check if a magnet status indicates it's ready/cached
 * @param status Status response from getMagnetStatusAd
 * @returns true if the magnet is ready (statusCode 4)
 */
export function isAdStatusReady(status: MagnetStatus): boolean {
	return status.statusCode === 4 && status.status === 'Ready';
}

/**
 * Validate if a string is a valid SHA-1 hash (40 hex characters)
 * @param hash Hash string to validate
 * @returns true if valid SHA-1 hash format
 */
export function isValidSHA40Hash(hash: string): boolean {
	return /^[a-fA-F0-9]{40}$/i.test(hash);
}

// ====================================================================
// Link Unlocking
// ====================================================================

interface UnlockLinkData {
	link: string;
	host: string;
	filename: string;
	streaming: string[];
	paws: boolean;
	filesize: number;
	id: string;
	hostDomain: string;
}

/**
 * Unlock an AllDebrid link to get a direct download URL
 * @param apiKey AllDebrid API key
 * @param link The AllDebrid link to unlock (e.g., https://alldebrid.com/f/...)
 * @returns The unlocked link data including the direct download URL
 */
export const unlockLink = async (apiKey: string, link: string): Promise<UnlockLinkData> => {
	const endpoint = `${config.allDebridHostname}/v4.1/link/unlock`;

	try {
		const params = new URLSearchParams();
		params.append('link', link);

		const response = await allDebridAxios.post<ApiResponse<UnlockLinkData>>(endpoint, params, {
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Authorization: `Bearer ${apiKey}`,
			},
		});

		if (response.data.status === 'error') {
			throw new Error(response.data.error?.message || 'Failed to unlock link');
		}

		return response.data.data!;
	} catch (error: any) {
		console.error('Error unlocking AllDebrid link:', error.message);
		throw error;
	}
};

// ====================================================================
// Rate Limiting
// ====================================================================

// AllDebrid: 600 req/min documented, use 500 for safety buffer
const adRequestTimestamps: number[] = [];
const AD_MAX_REQUESTS = 500;
const AD_TIME_WINDOW = 60000; // 1 minute in milliseconds

/**
 * Wait if AllDebrid rate limit would be exceeded
 * Implements a sliding window rate limiter
 * AllDebrid allows 600 requests per minute, we use 500 for safety
 */
export async function waitForAdRateLimit(): Promise<void> {
	const now = Date.now();

	// Remove timestamps older than the time window
	while (adRequestTimestamps.length > 0 && adRequestTimestamps[0] < now - AD_TIME_WINDOW) {
		adRequestTimestamps.shift();
	}

	// If we've hit the limit, wait until the oldest request expires
	if (adRequestTimestamps.length >= AD_MAX_REQUESTS) {
		const oldestTimestamp = adRequestTimestamps[0];
		const waitTime = oldestTimestamp + AD_TIME_WINDOW - now;

		if (waitTime > 0) {
			await delayWithMessageChannel(waitTime);
			// Recursively call to clean up and check again
			return waitForAdRateLimit();
		}
	}

	// Record this request
	adRequestTimestamps.push(now);
}
