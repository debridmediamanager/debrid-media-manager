/**
 * Unified library fetcher implementing Zurg's parallel fetching patterns
 * Adapts to each service's capabilities while maintaining efficiency
 */

import { MagnetStatus, getMagnetStatus } from '@/services/allDebrid';
import { getUserTorrentsList } from '@/services/realDebrid';
import { getTorrentList, getWebDownloadList } from '@/services/torbox';
import { UserTorrent } from '@/torrent/userTorrent';
import {
	convertToAllDebridUserTorrent,
	convertToTbUserTorrent,
	convertToTbWebDownloadUserTorrent,
	convertToUserTorrent,
	fetchPremiumize,
} from '@/utils/fetchTorrents';
import { CacheManager, getGlobalCache } from '../cache/CacheManager';
import { UnifiedRateLimiter, getGlobalRateLimiter } from '../rateLimit/UnifiedRateLimiter';

export type LibraryService = 'realdebrid' | 'alldebrid' | 'torbox' | 'premiumize';

export interface FetchOptions {
	forceRefresh?: boolean;
	onProgress?: (progress: number, total: number) => void;
	onBatchComplete?: (batch: UserTorrent[]) => void;
	signal?: AbortSignal;
	maxItems?: number;
	concurrency?: number;
}

export class UnifiedLibraryFetcher {
	private cache: CacheManager;
	private rateLimiter: UnifiedRateLimiter;
	private fetchingPromises: Map<string, Promise<UserTorrent[]>> = new Map();

	constructor(cache?: CacheManager, rateLimiter?: UnifiedRateLimiter) {
		this.cache = cache || getGlobalCache();
		this.rateLimiter = rateLimiter || getGlobalRateLimiter();
	}

	/**
	 * Fetch library from any service with unified interface
	 */
	async fetchLibrary(
		service: LibraryService,
		token: string,
		options: FetchOptions = {}
	): Promise<UserTorrent[]> {
		console.log(
			`[Fetcher] Starting fetch for ${service}, forceRefresh: ${options.forceRefresh}, maxItems: ${options.maxItems}`
		);
		const totalStart = Date.now();

		// Deduplicate concurrent requests for the same service
		const fetchKey = `${service}:${token}`;
		const existingPromise = this.fetchingPromises.get(fetchKey);
		if (existingPromise && !options.forceRefresh) {
			console.log(`[Fetcher] Using existing promise for ${service}`);
			return existingPromise;
		}

		const fetchPromise = this.performFetch(service, token, options);
		this.fetchingPromises.set(fetchKey, fetchPromise);

		try {
			const result = await fetchPromise;
			const totalTime = Date.now() - totalStart;
			console.log(
				`[Fetcher] Completed fetch for ${service} in ${totalTime}ms - ${result.length} items`
			);
			return result;
		} catch (error) {
			const totalTime = Date.now() - totalStart;
			console.error(`[Fetcher] Failed to fetch ${service} after ${totalTime}ms:`, error);
			throw error;
		} finally {
			this.fetchingPromises.delete(fetchKey);
		}
	}

	private async performFetch(
		service: LibraryService,
		token: string,
		options: FetchOptions
	): Promise<UserTorrent[]> {
		switch (service) {
			case 'realdebrid':
				return this.fetchRealDebrid(token, options);
			case 'alldebrid':
				return this.fetchAllDebrid(token, options);
			case 'torbox':
				return this.fetchTorbox(token, options);
			case 'premiumize':
				return this.fetchPremiumizeLibrary(token, options);
			default:
				throw new Error(`Unknown service: ${service}`);
		}
	}

	/**
	 * Premiumize needs no pagination and no per-item fan-out: three calls return
	 * the transfer queue, the root listing and every file in the account, and
	 * `fetchPremiumize` joins them. The only per-item cost is the `job/src` hash
	 * lookup, which runs for live transfers alone.
	 */
	private async fetchPremiumizeLibrary(
		token: string,
		options: FetchOptions
	): Promise<UserTorrent[]> {
		const cacheKey = `pm:library:${token}`;
		if (!options.forceRefresh) {
			const cached = await this.cache.get<UserTorrent[]>(cacheKey);
			if (cached) return cached;
		}

		let torrents: UserTorrent[] = [];
		await this.rateLimiter.execute('premiumize', 'pm-library', async () => {
			await fetchPremiumize(
				token,
				async (fetched) => {
					torrents = fetched;
				},
				options.maxItems
			);
		});

		options.onProgress?.(torrents.length, torrents.length);
		options.onBatchComplete?.(torrents);
		// Same short TTL the other services use, so a staleness sweep collapses
		// several tabs into one fetch.
		await this.cache.set(cacheKey, torrents, undefined, 5 * 60 * 1000);
		return torrents;
	}

	/**
	 * Fetch RealDebrid library with parallel pagination (like Zurg)
	 */
	private async fetchRealDebrid(token: string, options: FetchOptions): Promise<UserTorrent[]> {
		console.log(`[Fetcher] RealDebrid fetch starting, forceRefresh: ${options.forceRefresh}`);
		const rdStart = Date.now();

		const cacheKey = `rd:library:${token}`;

		// Check cache first
		if (!options.forceRefresh) {
			console.log(`[Fetcher] Checking cache for RealDebrid...`);
			const cached = await this.cache.get<UserTorrent[]>(cacheKey);
			if (cached) {
				console.log(`[Fetcher] Using cached RealDebrid data: ${cached.length} items`);
				return cached;
			}
			console.log(`[Fetcher] No cached data found for RealDebrid`);
		}

		// Step 1: Get first page to determine total count
		console.log(`[Fetcher] Getting RealDebrid total count...`);
		const countStart = Date.now();
		const firstPageResult = await this.rateLimiter.execute('realdebrid', 'rd-first-page', () =>
			getUserTorrentsList(token, 1, 1)
		);

		if (!firstPageResult.data.length) {
			console.log(`[Fetcher] No RealDebrid torrents found`);
			return [];
		}

		const totalCount = Math.min(firstPageResult.totalCount || 0, options.maxItems || Infinity);
		const pageSize = 1500; // Max items per page for RD
		const totalPages = Math.ceil(totalCount / pageSize);
		const concurrency = options.concurrency || 4; // Max 4 concurrent requests for RD

		console.log(
			`[Fetcher] RealDebrid total count retrieved in ${Date.now() - countStart}ms - ${totalCount} items, ${totalPages} pages, concurrency: ${concurrency}`
		);

		options.onProgress?.(0, totalCount);

		// Step 2: Create batch requests for parallel fetching
		const pages: number[] = [];
		for (let page = 1; page <= totalPages; page++) {
			pages.push(page);
		}

		// Step 3: Fetch pages in batches with controlled concurrency
		const allTorrents: UserTorrent[] = [];
		const batchSize = concurrency;
		const fetchStart = Date.now();

		console.log(
			`[Fetcher] Starting parallel fetch of ${pages.length} pages in batches of ${batchSize}`
		);

		for (let i = 0; i < pages.length; i += batchSize) {
			if (options.signal?.aborted) {
				throw new Error('Fetch aborted');
			}

			const batch = pages.slice(i, i + batchSize);
			const batchStart = Date.now();
			console.log(
				`[Fetcher] Fetching batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(pages.length / batchSize)}: pages ${batch.join(', ')}`
			);

			const batchPromises = batch.map((page) =>
				this.rateLimiter.execute('realdebrid', `rd-page-${page}`, () =>
					getUserTorrentsList(token, pageSize, page)
				)
			);

			const batchResults = await Promise.all(batchPromises);
			const batchTime = Date.now() - batchStart;

			let batchTorrentCount = 0;
			for (const result of batchResults) {
				const torrents = await this.processRealDebridTorrents(result.data);
				allTorrents.push(...torrents);
				batchTorrentCount += torrents.length;
				options.onBatchComplete?.(torrents);
				options.onProgress?.(allTorrents.length, totalCount);
			}

			console.log(
				`[Fetcher] Batch completed in ${batchTime}ms: ${batchTorrentCount} items, total: ${allTorrents.length}/${totalCount}`
			);
		}

		const fetchTime = Date.now() - fetchStart;
		console.log(
			`[Fetcher] All pages fetched in ${fetchTime}ms - ${allTorrents.length} total items`
		);

		// Cache the results
		console.log(`[Fetcher] Caching RealDebrid results...`);
		const cacheStart = Date.now();
		await this.cache.set(cacheKey, allTorrents, undefined, 5 * 60 * 1000);
		console.log(`[Fetcher] Results cached in ${Date.now() - cacheStart}ms`);

		const totalTime = Date.now() - rdStart;
		console.log(
			`[Fetcher] RealDebrid fetch completed in ${totalTime}ms - ${allTorrents.length} items`
		);

		return allTorrents;
	}

	/**
	 * Fetch AllDebrid library with optimized batching
	 */
	private async fetchAllDebrid(token: string, options: FetchOptions): Promise<UserTorrent[]> {
		console.log(`[Fetcher] AllDebrid fetch starting, forceRefresh: ${options.forceRefresh}`);
		const adStart = Date.now();
		const cacheKey = `ad:library:${token}`;

		// Check cache first
		if (!options.forceRefresh) {
			console.log('[Fetcher] Checking cache for AllDebrid...');
			const cached = await this.cache.get<UserTorrent[]>(cacheKey);
			if (cached) {
				console.log(`[Fetcher] Using cached AllDebrid data: ${cached.length} items`);
				return cached;
			}
			console.log('[Fetcher] No cached data found for AllDebrid');
		}

		// AllDebrid doesn't support pagination, fetch all at once
		const apiStart = Date.now();
		const result = await this.rateLimiter.execute('alldebrid', 'ad-fetch-all', () =>
			getMagnetStatus(token)
		);
		console.log(
			`[Fetcher] AllDebrid API responded in ${Date.now() - apiStart}ms with ${
				result.data?.magnets?.length ?? 0
			} magnets`
		);

		if (!result.data?.magnets) {
			console.log('[Fetcher] AllDebrid API returned no magnets');
			console.log('[Fetcher] Cached empty AllDebrid result for 5 minutes');
			console.log(
				`[Fetcher] AllDebrid fetch completed in ${Date.now() - adStart}ms - 0 items`
			);
			return [];
		}

		const magnets = result.data.magnets;
		console.log(`[Fetcher] Processing ${magnets.length} AllDebrid magnets (batch size 50)`);
		options.onProgress?.(0, magnets.length);

		// Process magnets in batches for better performance
		const batchSize = 50;
		const allTorrents: UserTorrent[] = [];

		for (let i = 0; i < magnets.length; i += batchSize) {
			if (options.signal?.aborted) {
				throw new Error('Fetch aborted');
			}

			const batch = magnets.slice(i, i + batchSize);
			const batchStart = Date.now();
			const torrents = await this.processAllDebridMagnets(batch);
			allTorrents.push(...torrents);
			options.onBatchComplete?.(torrents);
			options.onProgress?.(allTorrents.length, magnets.length);
			console.log(
				`[Fetcher] AllDebrid batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
					magnets.length / batchSize
				)} processed in ${Date.now() - batchStart}ms - ${torrents.length} items (total ${
					allTorrents.length
				}/${magnets.length})`
			);
		}

		// Cache the results
		const cacheStart = Date.now();
		console.log(`[Fetcher] Caching AllDebrid results (${allTorrents.length} items)`);
		await this.cache.set(cacheKey, allTorrents, undefined, 5 * 60 * 1000);
		console.log(`[Fetcher] AllDebrid cache write completed in ${Date.now() - cacheStart}ms`);
		console.log(
			`[Fetcher] AllDebrid fetch completed in ${Date.now() - adStart}ms - ${allTorrents.length} items`
		);

		return allTorrents;
	}

	/**
	 * Fetch Torbox library with pagination support
	 */
	private async fetchTorbox(token: string, options: FetchOptions): Promise<UserTorrent[]> {
		console.log(`[Fetcher] Torbox fetch starting, forceRefresh: ${options.forceRefresh}`);
		const tbStart = Date.now();
		const cacheKey = `tb:library:${token}`;

		// Check cache first
		if (!options.forceRefresh) {
			console.log('[Fetcher] Checking cache for Torbox...');
			const cached = await this.cache.get<UserTorrent[]>(cacheKey);
			if (cached) {
				console.log(`[Fetcher] Using cached Torbox data: ${cached.length} items`);
				return cached;
			}
			console.log('[Fetcher] No cached data found for Torbox');
		}

		// Torbox supports pagination but doesn't return total count reliably
		// Fetch in batches until we get an empty response
		const pageSize = 100;
		const allTorrents: UserTorrent[] = [];
		let offset = 0;
		let hasMore = true;
		let loop = 0;

		while (hasMore && (!options.maxItems || allTorrents.length < options.maxItems)) {
			if (options.signal?.aborted) {
				throw new Error('Fetch aborted');
			}

			console.log('[Fetcher] Torbox requesting page', {
				offset,
				pageSize,
				iteration: ++loop,
			});
			const apiStart = Date.now();
			const result = await this.rateLimiter.execute('torbox', `tb-page-${offset}`, () =>
				getTorrentList(token, {
					bypass_cache: true,
					offset,
					limit: pageSize,
				})
			);
			console.log(
				`[Fetcher] Torbox page received in ${Date.now() - apiStart}ms (success=${result.success})`
			);

			if (!result.success || !result.data) {
				console.log('[Fetcher] Torbox response indicated completion', {
					success: result.success,
					hasData: Boolean(result.data),
				});
				hasMore = false;
				break;
			}

			const torrentsData = Array.isArray(result.data) ? result.data : [result.data];
			if (torrentsData.length === 0) {
				console.log('[Fetcher] Torbox returned empty page');
				hasMore = false;
				break;
			}

			const torrents = await this.processTorboxTorrents(torrentsData);
			allTorrents.push(...torrents);
			options.onBatchComplete?.(torrents);
			options.onProgress?.(allTorrents.length, allTorrents.length + pageSize);
			console.log('[Fetcher] Torbox page processed', {
				iteration: loop,
				pageCount: torrentsData.length,
				totalItems: allTorrents.length,
			});

			offset += pageSize;
			hasMore = torrentsData.length === pageSize;
		}

		// Web downloads are a second, separately paginated list on the same
		// account. Losing them must not cost the user their torrents, so a
		// failure here is logged and the torrents are returned regardless.
		try {
			allTorrents.push(
				...(await this.fetchTorboxWebDownloads(token, options, allTorrents.length))
			);
		} catch (error) {
			console.error('[Fetcher] Torbox web downloads failed', error);
		}

		// Cache the results
		const cacheStart = Date.now();
		console.log(`[Fetcher] Caching Torbox results (${allTorrents.length} items)`);
		await this.cache.set(cacheKey, allTorrents, undefined, 5 * 60 * 1000);
		console.log(`[Fetcher] Torbox cache write completed in ${Date.now() - cacheStart}ms`);
		console.log(
			`[Fetcher] Torbox fetch completed in ${Date.now() - tbStart}ms - ${allTorrents.length} items`
		);

		return allTorrents;
	}

	/**
	 * Fetch the account's TorBox web downloads — direct/hoster links TorBox
	 * downloaded on the user's behalf, which the library shows alongside torrents.
	 */
	private async fetchTorboxWebDownloads(
		token: string,
		options: FetchOptions,
		alreadyFetched: number
	): Promise<UserTorrent[]> {
		const pageSize = 100;
		const webDownloads: UserTorrent[] = [];
		let offset = 0;
		let hasMore = true;
		let loop = 0;

		while (
			hasMore &&
			(!options.maxItems || alreadyFetched + webDownloads.length < options.maxItems)
		) {
			if (options.signal?.aborted) {
				throw new Error('Fetch aborted');
			}

			console.log('[Fetcher] Torbox requesting web download page', {
				offset,
				pageSize,
				iteration: ++loop,
			});
			const result = await this.rateLimiter.execute('torbox', `tb-webdl-${offset}`, () =>
				getWebDownloadList(token, {
					bypass_cache: true,
					offset,
					limit: pageSize,
				})
			);

			if (!result.success || !result.data) {
				hasMore = false;
				break;
			}

			const page = Array.isArray(result.data) ? result.data : [result.data];
			if (page.length === 0) {
				hasMore = false;
				break;
			}

			const converted = page.map((w) => convertToTbWebDownloadUserTorrent(w));
			webDownloads.push(...converted);
			options.onBatchComplete?.(converted);

			offset += pageSize;
			hasMore = page.length === pageSize;
		}

		console.log(`[Fetcher] Torbox web downloads fetched - ${webDownloads.length} items`);
		return webDownloads;
	}

	// Conversion helpers (these would import from existing utils)
	private async processRealDebridTorrents(data: any[]): Promise<UserTorrent[]> {
		return data.map((t) => convertToUserTorrent(t));
	}

	private async processAllDebridMagnets(magnets: MagnetStatus[]): Promise<UserTorrent[]> {
		return magnets.map((m) => convertToAllDebridUserTorrent(m));
	}

	private async processTorboxTorrents(data: any[]): Promise<UserTorrent[]> {
		return data.map((t) => convertToTbUserTorrent(t));
	}

	/**
	 * Clear cache for a specific service or all services
	 */
	async clearCache(service?: string, token?: string): Promise<void> {
		if (service && token) {
			const cacheKey = `${service}:library:${token}`;
			await this.cache.clear([cacheKey]);
		} else {
			// Clear all library caches
			await this.cache.clear();
		}
	}
}
