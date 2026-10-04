import type { TorBoxOperation } from '@/lib/observability/torboxOperationalStats';
import {
	recordTorBoxOperationEvent,
	resolveTorBoxOperation,
} from '@/lib/observability/torboxOperationalStats';
import { delay as delayWithMessageChannel } from '@/utils/delay';
import { toMagnetUri } from '@/utils/extractHashes';
import type { InternalAxiosRequestConfig } from 'axios';
import axios from 'axios';
import getConfig from 'next/config';
import type {
	TorBoxCachedItem,
	TorBoxCachedResponse,
	TorBoxCreateTorrentResponse,
	TorBoxCreateWebDownloadResponse,
	TorBoxResponse,
	TorBoxTorrentInfo,
	TorBoxTorrentMetadata,
	TorBoxUsenetDownload,
	TorBoxUser,
	TorBoxWebDownload,
} from './types';

export type { TorBoxCachedResponse, TorBoxTorrentInfo, TorBoxUser, TorBoxWebDownload };

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
	createwebdownload: 50,
	default: 250,
};

// Calls in flight at once for one key. In the browser that is the member's
// own key; on the server every member's key gets its own (see KeyBudget).
const MAX_GLOBAL_CONCURRENT = 15;
const DEFAULT_RETRY_AFTER_MS = 300_000; // 5 minutes

// Rate limiting state
let globalPausedUntil = 0;

// In the browser this client serves one member's key, and a 429 pauses
// everything. On the server it serves every member at once, and TorBox's 429
// is a lockout of one key for its Retry-After (measured 2026-08-02: 300 s, and
// requests made during it do not extend it). So there a lockout is kept per
// key, and a caller - always an HTTP request, cut at 60 s by the proxy and
// given up on far sooner by a player - never sits one out: it is refused at
// once, without asking TorBox. Before this, one member's 429 held every
// member's stream list and play in that process for five minutes.
const isServer = () => typeof window === 'undefined';
const serverLockedUntil = new Map<string, number>();
/** The longest a server-side call waits on this process's limiter. */
const SERVER_MAX_WAIT_MS = 5_000;

function keyOf(config: { headers?: unknown } | undefined): string {
	const headers = config?.headers as
		| { get?: (name: string) => unknown; Authorization?: unknown }
		| undefined;
	const value =
		typeof headers?.get === 'function' ? headers.get('Authorization') : headers?.Authorization;
	return typeof value === 'string' ? value.replace(/^Bearer\s+/i, '') : '';
}

function pausedUntilFor(key: string): number {
	return isServer() ? (serverLockedUntil.get(key) ?? 0) : globalPausedUntil;
}

function recordLockout(key: string, retryAfterMs: number): void {
	const until = Date.now() + retryAfterMs;
	if (!isServer()) {
		globalPausedUntil = until;
		return;
	}
	const now = Date.now();
	for (const [lockedKey, lockedUntil] of serverLockedUntil) {
		if (lockedUntil <= now) serverLockedUntil.delete(lockedKey);
	}
	serverLockedUntil.set(key, until);
}

const endpointTimestamps: Record<string, number[]> = {};
const concurrencyWaiters: Array<() => void> = [];

/**
 * One key's share of this process's TorBox budget: calls in flight, callers
 * waiting for one to finish, and each endpoint's calls in the last minute.
 *
 * TorBox limits each API key on its own (docs: per key, not per IP). In the
 * browser this client holds one key, so one budget is that key's. On the
 * server it holds every member's, and one budget for all of them meant one
 * member's burst spent everyone's: dmm-01's access log for 2026-09-27..10-04
 * has one install loading 32 library catalogs in a second (96 TorBox calls)
 * and another playing 182 times in a minute, against 15 slots and 80
 * requestdl a minute per replica - with no limit on the wait for a slot.
 */
interface KeyBudget {
	inFlight: number;
	waiters: Array<() => void>;
	stamps: Record<string, number[]>;
}

const browserBudget: KeyBudget = {
	inFlight: 0,
	waiters: concurrencyWaiters,
	stamps: endpointTimestamps,
};
const serverBudgets = new Map<string, KeyBudget>();
let lastBudgetSweep = 0;

function budgetFor(key: string): KeyBudget {
	if (!isServer()) return browserBudget;
	let budget = serverBudgets.get(key);
	if (!budget) {
		budget = { inFlight: 0, waiters: [], stamps: {} };
		serverBudgets.set(key, budget);
	}
	return budget;
}

/** Forgets the budgets of keys with nothing in flight and no call this minute. */
function sweepIdleBudgets(now: number): void {
	if (now - lastBudgetSweep < 60_000) return;
	lastBudgetSweep = now;
	for (const [key, budget] of serverBudgets) {
		if (budget.inFlight > 0 || budget.waiters.length > 0) continue;
		const active = Object.values(budget.stamps).some(
			(stamps) => stamps.length > 0 && stamps[stamps.length - 1] > now - 60_000
		);
		if (!active) serverBudgets.delete(key);
	}
}

// Custom error class for rate limiting
export class TorBoxRateLimitError extends Error {
	/**
	 * Thrown only once this client's own retry ladder is spent, so an outer
	 * layer must not run it again - see UnifiedRateLimiter.isRetryableError.
	 */
	readonly retryable = false;

	constructor(message: string = 'TorBox API rate limit exceeded. Please wait and try again.') {
		super(message);
		this.name = 'TorBoxRateLimitError';
	}
}

function getEndpointKey(url?: string): string {
	if (!url) return 'default';
	if (url.includes('/requestdl')) return 'requestdl';
	if (url.includes('/createtorrent')) return 'createtorrent';
	if (url.includes('/createwebdownload')) return 'createwebdownload';
	return 'default';
}

/** Waits up to `ms` for a slot to free up; false if none did. */
function waitForSlot(budget: KeyBudget, ms: number): Promise<boolean> {
	return new Promise((resolve) => {
		const wake = () => {
			clearTimeout(timer);
			resolve(true);
		};
		const timer = setTimeout(() => {
			const index = budget.waiters.indexOf(wake);
			if (index !== -1) budget.waiters.splice(index, 1);
			resolve(false);
		}, ms);
		budget.waiters.push(wake);
	});
}

async function acquireConcurrencySlot(key: string = ''): Promise<void> {
	const budget = budgetFor(key);
	if (!isServer()) {
		while (budget.inFlight >= MAX_GLOBAL_CONCURRENT) {
			await new Promise<void>((resolve) => budget.waiters.push(resolve));
		}
		budget.inFlight++;
		return;
	}
	// A server-side caller is an HTTP request that a player gives up on in
	// seconds, so it waits for a slot no longer than for anything else.
	sweepIdleBudgets(Date.now());
	const deadline = Date.now() + SERVER_MAX_WAIT_MS;
	while (budget.inFlight >= MAX_GLOBAL_CONCURRENT) {
		const remaining = deadline - Date.now();
		if (remaining <= 0 || !(await waitForSlot(budget, remaining))) {
			throw new TorBoxRateLimitError(
				`${MAX_GLOBAL_CONCURRENT} TorBox calls for this key are already in flight. Please try again.`
			);
		}
	}
	budget.inFlight++;
}

function releaseConcurrencySlot(key: string = ''): void {
	const budget = budgetFor(key);
	budget.inFlight = Math.max(0, budget.inFlight - 1);
	const waiter = budget.waiters.shift();
	if (waiter) waiter();
}

async function enforceEndpointLimit(endpointKey: string, key: string = ''): Promise<void> {
	// Pause from a 429: the whole client in the browser, this key on the server
	const pauseRemaining = pausedUntilFor(key) - Date.now();
	if (pauseRemaining > SERVER_MAX_WAIT_MS && isServer()) {
		throw new TorBoxRateLimitError();
	}
	if (pauseRemaining > 0) {
		console.log(
			`[TorBox] Global rate limit pause, waiting ${Math.round(pauseRemaining / 1000)}s`
		);
		await delayWithMessageChannel(pauseRemaining);
	}

	const limit = ENDPOINT_LIMITS[endpointKey] ?? ENDPOINT_LIMITS.default;
	const stamps = budgetFor(key).stamps;
	if (!stamps[endpointKey]) stamps[endpointKey] = [];
	const timestamps = stamps[endpointKey];

	const now = Date.now();
	const windowStart = now - 60_000;
	// Prune old entries
	while (timestamps.length > 0 && timestamps[0] < windowStart) timestamps.shift();

	if (timestamps.length >= limit) {
		const waitMs = timestamps[0] + 60_000 - now + Math.random() * 500;
		if (waitMs > SERVER_MAX_WAIT_MS && isServer()) {
			throw new TorBoxRateLimitError();
		}
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
	/** The key whose budget holds this call's slot. */
	__budgetKey?: string;
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
	return baseUrl.replace('#num#', Math.floor(Math.random() * 1000).toString());
}

// Get the base URL for TorBox API (with or without proxy)
// Server-side calls bypass the proxy (the CF Worker rejects them with 403);
// client-side calls go through the Cloudflare Worker to avoid CORS.
//
// Browser traffic must NOT go through our own anticors (`authProxy`). That
// hostname is wildcard DNS onto the single dmm-01 host, so it pools every
// user's TorBox calls into one per-IP rate-limit bucket - TorBox began 429ing
// 7 minutes after we tried it on 2026-08-24 and throttled ~20% of all calls
// until it was reverted. The Worker egresses from Cloudflare's pool instead,
// which is what keeps each user in their own bucket. It is also the only safe
// path for requestdl, which puts the raw API key in `?token=`: our own nginx
// logs query strings, the Worker does not.
//
// Observing this traffic is the Worker's job, not a reason to re-route it.
function getTorBoxBaseUrl(): string {
	const torboxHost = config.torboxHostname || BASE_URL;
	const isServer = typeof window === 'undefined';
	if (isServer) {
		return torboxHost;
	}
	if (config.proxy) {
		return `${getProxyUrl(config.proxy)}${torboxHost}`;
	}
	return torboxHost;
}

// Resolves which monitored TorBox operation a request represents, so the status
// page can report what real DMM users' calls returned. Requests routed through
// an anticors proxy carry the real target in `?url=`, so unwrap that first.
function resolveOperationFromConfig(cfg: {
	method?: string;
	url?: string;
}): TorBoxOperation | null {
	if (!cfg.url) return null;
	try {
		const parsed = new URL(cfg.url, BASE_URL);
		const proxied = parsed.searchParams.get('url');
		const pathname = proxied ? new URL(proxied).pathname : parsed.pathname;
		return resolveTorBoxOperation(cfg.method, pathname);
	} catch {
		return null;
	}
}

// Records the terminal outcome of a request. Called only where the interceptor
// settles - never on a path that is about to retry, so one logical call counts
// once, matching how realDebrid.ts records at its call sites.
function recordOutcome(cfg: { method?: string; url?: string } | undefined, status: number): void {
	if (!cfg) return;
	const operation = resolveOperationFromConfig(cfg);
	if (operation) {
		recordTorBoxOperationEvent(operation, status);
	}
}

// Create a global axios instance for TorBox API requests
const torBoxAxios = axios.create({
	timeout: REQUEST_TIMEOUT,
});

torBoxAxios.interceptors.request.use(async (config: ExtendedAxiosRequestConfig) => {
	const endpointKey = getEndpointKey(config.url);
	config.__endpointKey = endpointKey;
	const budgetKey = keyOf(config);
	config.__budgetKey = budgetKey;

	await enforceEndpointLimit(endpointKey, budgetKey);

	if (!config.__slotAcquired) {
		await acquireConcurrencySlot(budgetKey);
		config.__slotAcquired = true;
	}

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
			releaseConcurrencySlot(cfg.__budgetKey);
			cfg.__slotAcquired = false;
		}
		recordOutcome(cfg, response.status);
		return response;
	},
	async (error) => {
		const originalConfig = error.config as ExtendedAxiosRequestConfig;

		if (!originalConfig) {
			return Promise.reject(error);
		}

		const releaseSlot = () => {
			if (originalConfig.__slotAcquired) {
				releaseConcurrencySlot(originalConfig.__budgetKey);
				originalConfig.__slotAcquired = false;
			}
		};

		if (error.response?.status === 429 && isServer()) {
			recordLockout(
				keyOf(originalConfig),
				parseRetryAfterMs(error) ?? DEFAULT_RETRY_AFTER_MS
			);
		}

		if (originalConfig.__skipRetry) {
			releaseSlot();
			recordOutcome(originalConfig, error.response?.status ?? 500);
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
			recordOutcome(originalConfig, status ?? 500);
			if (is429) return Promise.reject(new TorBoxRateLimitError());
			return Promise.reject(error);
		}

		// TorBox answers application conditions with an HTTP 5xx carrying its own
		// envelope: DATABASE_ERROR when the torrent id is not in the account, and
		// DOWNLOAD_SERVER_ERROR when it will not carry out a control operation.
		// Neither clears on retry - and retrying a mutation is what manufactures
		// the first one, because the delete lands, the response is lost, and the
		// retry finds the torrent already gone. realDebrid.ts skips retries on RD's
		// equivalent (a 503 carrying an error_code) for the same reason.
		//
		// An edge 5xx has no envelope - TorBox never answered - and stays
		// retryable, which is the case the ladder was built for.
		const isApplicationError =
			status >= 500 && status < 600 && error.response?.data?.success === false;
		if (isApplicationError) {
			releaseSlot();
			recordOutcome(originalConfig, status);
			return Promise.reject(error);
		}

		const shouldRetry = (status >= 500 && status < 600) || is429;
		if (!shouldRetry) {
			releaseSlot();
			// No response at all (DNS failure, timeout, connection reset) is a
			// failed call as far as a user is concerned, so it counts as 5xx.
			recordOutcome(originalConfig, status ?? 500);
			return Promise.reject(error);
		}

		originalConfig.__retryCount++;
		originalConfig.__isRetryRequest = true;

		let retryAfterMs: number | undefined;
		if (is429) {
			retryAfterMs = parseRetryAfterMs(error) ?? DEFAULT_RETRY_AFTER_MS;
			if (!isServer()) recordLockout(keyOf(originalConfig), retryAfterMs);
		}

		const retryDelay = calculateRetryDelay(originalConfig.__retryCount, retryAfterMs);
		// A server-side caller is an HTTP request: it gets this answer now
		// rather than a better one after the client has gone.
		if (retryDelay > SERVER_MAX_WAIT_MS && isServer()) {
			releaseSlot();
			recordOutcome(originalConfig, status);
			if (is429) return Promise.reject(new TorBoxRateLimitError());
			return Promise.reject(error);
		}
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
	if (params.magnet) formData.append('magnet', toMagnetUri(params.magnet));
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
		// TorBox's own set; sending `pause` earns a 400 INVALID_OPTION
		operation: 'reannounce' | 'delete' | 'resume' | 'stop_seeding';
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
			if (params.magnet) formData.append('magnet', toMagnetUri(params.magnet));
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

// ==================== Web Downloads API ====================
//
// Web downloads are direct/hoster links TorBox fetches on the user's behalf.
// They live in a separate namespace from torrents: their own list, their own
// download-link endpoint, and their own ids (which overlap torrent ids, hence
// the `tb:w` prefix DMM gives them in the library).

export const createWebDownload = async (
	accessToken: string,
	params: {
		link: string;
		password?: string;
		name?: string;
		as_queued?: boolean;
		add_only_if_cached?: boolean;
	}
): Promise<TorBoxResponse<TorBoxCreateWebDownloadResponse>> => {
	const formData = new FormData();
	formData.append('link', params.link);
	if (params.password) formData.append('password', params.password);
	if (params.name) formData.append('name', params.name);
	if (params.as_queued !== undefined) formData.append('as_queued', String(params.as_queued));
	if (params.add_only_if_cached !== undefined)
		formData.append('add_only_if_cached', String(params.add_only_if_cached));

	const response = await torBoxAxios.post<TorBoxResponse<TorBoxCreateWebDownloadResponse>>(
		`${getTorBoxBaseUrl()}/${API_VERSION}/api/webdl/createwebdownload`,
		formData,
		getAxiosConfig(accessToken)
	);
	return response.data;
};

export const getWebDownloadList = async (
	accessToken: string,
	params?: {
		bypass_cache?: boolean;
		id?: number;
		offset?: number;
		limit?: number;
	}
): Promise<TorBoxResponse<TorBoxWebDownload[] | TorBoxWebDownload>> => {
	const requestMeta = {
		hasId: Boolean(params?.id),
		offset: params?.offset ?? 0,
		limit: params?.limit ?? 'default',
	};
	const requestStartedAt = Date.now();
	console.log('[TorboxAPI] getWebDownloadList start', requestMeta);

	const queryParams = {
		...params,
		bypass_cache: true, // Always fetch fresh uncached results
		_fresh: Date.now(),
	};

	const response = await torBoxAxios.get<TorBoxResponse<TorBoxWebDownload[] | TorBoxWebDownload>>(
		`${getTorBoxBaseUrl()}/${API_VERSION}/api/webdl/mylist`,
		{ params: queryParams, ...getAxiosConfig(accessToken) }
	);
	const result = response.data;
	const itemCount = Array.isArray(result.data) ? result.data.length : result.data ? 1 : 0;
	console.log('[TorboxAPI] getWebDownloadList success', {
		...requestMeta,
		success: result.success,
		itemCount,
		elapsedMs: Date.now() - requestStartedAt,
	});
	return result;
};

/**
 * The account's usenet downloads. A third list beside torrents and web
 * downloads, with the same shape and its own id space.
 */
export const getUsenetList = async (
	accessToken: string,
	params?: {
		bypass_cache?: boolean;
		id?: number;
		offset?: number;
		limit?: number;
	}
): Promise<TorBoxResponse<TorBoxUsenetDownload[] | TorBoxUsenetDownload>> => {
	const requestMeta = {
		hasId: Boolean(params?.id),
		offset: params?.offset ?? 0,
		limit: params?.limit ?? 'default',
	};
	const requestStartedAt = Date.now();
	console.log('[TorboxAPI] getUsenetList start', requestMeta);

	const response = await torBoxAxios.get<
		TorBoxResponse<TorBoxUsenetDownload[] | TorBoxUsenetDownload>
	>(`${getTorBoxBaseUrl()}/${API_VERSION}/api/usenet/mylist`, {
		params: { ...params, bypass_cache: true, _fresh: Date.now() },
		...getAxiosConfig(accessToken),
	});
	const result = response.data;
	console.log('[TorboxAPI] getUsenetList success', {
		...requestMeta,
		success: result.success,
		itemCount: Array.isArray(result.data) ? result.data.length : result.data ? 1 : 0,
		elapsedMs: Date.now() - requestStartedAt,
	});
	return result;
};

/** A download link for one file of a usenet download. */
export const requestUsenetLink = async (
	accessToken: string,
	params: { usenet_id: number; file_id?: number; user_ip?: string },
	options?: { timeout?: number }
): Promise<TorBoxResponse<string>> => {
	const response = await torBoxAxios.get<TorBoxResponse<string>>(
		`${getTorBoxBaseUrl()}/${API_VERSION}/api/usenet/requestdl`,
		{
			params: { token: accessToken, ...params },
			...getAxiosConfig(accessToken),
			...(options?.timeout && { timeout: options.timeout }),
		}
	);
	return response.data;
};

export const controlWebDownload = async (
	accessToken: string,
	params: {
		webdl_id?: number;
		// TorBox accepts only `delete` here - `pause` and `resume` are 400
		// INVALID_OPTION, unlike the torrent endpoint's wider set
		operation: 'delete';
		all?: boolean;
	}
): Promise<TorBoxResponse<null>> => {
	const response = await torBoxAxios.post<TorBoxResponse<null>>(
		`${getTorBoxBaseUrl()}/${API_VERSION}/api/webdl/controlwebdownload`,
		params,
		getAxiosConfig(accessToken)
	);
	return response.data;
};

export const deleteWebDownload = async (
	accessToken: string,
	webdl_id: number
): Promise<TorBoxResponse<null>> => {
	return controlWebDownload(accessToken, { webdl_id, operation: 'delete' });
};

export const requestWebDownloadLink = async (
	accessToken: string,
	params: {
		web_id: number;
		file_id?: number;
		zip_link?: boolean;
		user_ip?: string;
		redirect?: boolean;
	},
	options?: { skipRetry?: boolean; timeout?: number }
): Promise<TorBoxResponse<string>> => {
	const response = await torBoxAxios.get<TorBoxResponse<string>>(
		`${getTorBoxBaseUrl()}/${API_VERSION}/api/webdl/requestdl`,
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
		return browserBudget.inFlight;
	},
	set globalConcurrent(v: number) {
		browserBudget.inFlight = v;
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
	SERVER_MAX_WAIT_MS,
	serverLockedUntil,
	serverBudgets,
	resetState() {
		browserBudget.inFlight = 0;
		globalPausedUntil = 0;
		serverLockedUntil.clear();
		serverBudgets.clear();
		lastBudgetSweep = 0;
		for (const key of Object.keys(endpointTimestamps)) delete endpointTimestamps[key];
		concurrencyWaiters.length = 0;
	},
};
