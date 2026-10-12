import { getUserTorrentsList } from '@/services/realDebrid';
import { UserTorrentResponse, UserTorrentsResult } from '@/services/types';
import { UserTorrent } from '@/torrent/userTorrent';
import { convertToUserTorrent, withOriginalRdNames } from './fetchTorrents';

// Cache storage for torrents (similar to Zurg's atomic.Pointer)
let cachedTorrents: UserTorrent[] | null = null;
let cacheTimestamp: number = 0;

// Cache expiry time (30 minutes)
const CACHE_EXPIRY = 30 * 60 * 1000;

interface FetchResult {
	torrents: UserTorrent[];
	totalCount: number;
	cacheHit: boolean;
}

type ProgressCallback = (loaded: number, total: number) => void;
type IncrementalCallback = (torrents: UserTorrent[], pageNum: number, totalPages: number) => void;

/**
 * Fetches RealDebrid torrents with Zurg-style caching strategy
 * This function implements the smart caching logic from Zurg:
 * 1. Fetches first page
 * 2. Checks if it matches cached data
 * 3. If match found, returns cached data + new items
 * 4. Otherwise fetches all pages in parallel
 */
export async function fetchRealDebridWithCache(
	rdKey: string,
	useCache: boolean = true,
	customLimit?: number,
	onProgress?: ProgressCallback
): Promise<FetchResult> {
	try {
		const startTime = Date.now();
		console.log(
			`[${new Date().toISOString()}] fetchRealDebridWithCache start (useCache=${useCache}, customLimit=${customLimit ?? 'none'})`
		);
		// Step 1: Fetch the first page to get total count and check cache
		// Using optimal page size based on benchmarking
		const pageSize = 1500; // Optimal balance: ~2.7s per page through proxy
		const firstPageStart = Date.now();
		// Always fetch full page for cache matching (except for custom limits)
		const firstPageLimit = customLimit ?? pageSize;
		let { data: firstPageData, totalCount } = await getUserTorrentsList(
			rdKey,
			firstPageLimit,
			1
		);
		console.log(
			`[${new Date().toISOString()}]   First page fetch: ${Date.now() - firstPageStart}ms (${firstPageData.length} items)`
		);

		if (!firstPageData.length || !totalCount || totalCount === 0) {
			console.log(
				`[${new Date().toISOString()}] fetchRealDebridWithCache early end: no data`
			);
			return { torrents: [], totalCount: 0, cacheHit: false };
		}

		// Convert first page to UserTorrent format
		const conversionStart = Date.now();
		let firstPageTorrents = (await withOriginalRdNames(rdKey, firstPageData)).map(
			convertToUserTorrent
		);
		console.log(
			`[${new Date().toISOString()}]   First page conversion: ${Date.now() - conversionStart}ms`
		);

		// If custom limit is small, just return the first page
		if (customLimit && customLimit <= pageSize) {
			const result: FetchResult = {
				torrents: firstPageTorrents.slice(0, customLimit),
				totalCount: customLimit,
				cacheHit: false,
			};
			console.log(
				`[${new Date().toISOString()}] fetchRealDebridWithCache end (customLimit) - Total: ${Date.now() - startTime}ms`
			);
			return result;
		}

		// Step 2: Check for cache hit (Zurg's smart caching logic)
		if (useCache && cachedTorrents && cachedTorrents.length > 0) {
			const cacheAge = Date.now() - cacheTimestamp;

			// Don't use cache if it's too old
			if (cacheAge < CACHE_EXPIRY) {
				// Try to find matching point between fresh data and cache
				for (let cacheIdx = 0; cacheIdx < cachedTorrents.length; cacheIdx++) {
					for (let freshIdx = 0; freshIdx < firstPageTorrents.length; freshIdx++) {
						const cached = cachedTorrents[cacheIdx];
						const fresh = firstPageTorrents[freshIdx];

						// Check if IDs match (don't check progress/status as they can change)
						// This indicates we found the overlap point
						if (fresh.id === cached.id) {
							// Calculate expected positions
							const expectedCount = Math.ceil(totalCount / pageSize) * pageSize;
							const cacheIdxFromEnd = cachedTorrents.length - 1 - cacheIdx;
							const freshIdxFromEnd = expectedCount - 1 - freshIdx;

							// If positions match, we have a cache hit
							if (freshIdxFromEnd === cacheIdxFromEnd) {
								console.log(
									`[${new Date().toISOString()}] Cache hit! Using cached data from index ${cacheIdx}`
								);

								// Build result: new items + cached items
								const allTorrents = [
									...firstPageTorrents.slice(0, freshIdx),
									...cachedTorrents.slice(cacheIdx),
								];

								// Update cache with the new complete list
								cachedTorrents = allTorrents;
								cacheTimestamp = Date.now();

								const result: FetchResult = {
									torrents: allTorrents,
									totalCount: allTorrents.length,
									cacheHit: true,
								};
								console.log(
									`[${new Date().toISOString()}] fetchRealDebridWithCache end (cache hit) - Total: ${Date.now() - startTime}ms`
								);
								return result;
							}
						}
					}
				}
				console.log(`[${new Date().toISOString()}] Cache miss - no matching overlap found`);
			} else {
				console.log(`[${new Date().toISOString()}] Cache expired, fetching fresh data`);
			}
		}

		// Step 3: Cache miss or cache disabled - fetch all pages in parallel
		const maxPages = Math.ceil(totalCount / pageSize);
		console.log(
			`[${new Date().toISOString()}] Fetching ${maxPages} pages (${totalCount} torrents total)`
		);

		if (maxPages === 1) {
			// Update cache
			cachedTorrents = firstPageTorrents;
			cacheTimestamp = Date.now();

			const result: FetchResult = {
				torrents: firstPageTorrents,
				totalCount: firstPageTorrents.length,
				cacheHit: false,
			};
			console.log(
				`[${new Date().toISOString()}] fetchRealDebridWithCache end (single page) - Total: ${Date.now() - startTime}ms`
			);
			return result;
		}

		// Fetch remaining pages in optimal batches
		const parallelFetchStart = Date.now();
		const BATCH_SIZE = 4; // Optimal batch size for parallel fetching
		const remainingPages: UserTorrentsResult[] = [];
		let pagesLoaded = 1; // Already loaded first page

		for (let i = 2; i <= maxPages; i += BATCH_SIZE) {
			const batchStart = Date.now();
			const batchEnd = Math.min(i + BATCH_SIZE - 1, maxPages);
			const batchPromises: Promise<UserTorrentsResult>[] = [];

			for (let page = i; page <= batchEnd; page++) {
				batchPromises.push(getUserTorrentsList(rdKey, pageSize, page));
			}

			const batchResults = await Promise.all(batchPromises);
			remainingPages.push(...batchResults);
			pagesLoaded += batchResults.length;

			// Report progress
			if (onProgress) {
				onProgress(pagesLoaded, maxPages);
			}

			console.log(
				`[${new Date().toISOString()}]     Batch ${Math.ceil((i - 1) / BATCH_SIZE)} (pages ${i}-${batchEnd}): ${Date.now() - batchStart}ms (${pagesLoaded}/${maxPages} pages loaded)`
			);
		}
		console.log(
			`[${new Date().toISOString()}]   Total fetch of ${maxPages - 1} pages: ${Date.now() - parallelFetchStart}ms`
		);

		// Combine all pages
		const combineStart = Date.now();
		const allData: UserTorrentResponse[] = [
			...firstPageData,
			...remainingPages.flatMap((page) => page.data),
		];
		console.log(
			`[${new Date().toISOString()}]   Data combination: ${Date.now() - combineStart}ms (${allData.length} items)`
		);

		// Convert all to UserTorrent format
		const conversionStart2 = Date.now();
		const allTorrents = (await withOriginalRdNames(rdKey, allData)).map(convertToUserTorrent);
		console.log(
			`[${new Date().toISOString()}]   Final conversion: ${Date.now() - conversionStart2}ms`
		);

		// Update cache
		const cacheUpdateStart = Date.now();
		cachedTorrents = allTorrents;
		cacheTimestamp = Date.now();
		console.log(
			`[${new Date().toISOString()}]   Cache update: ${Date.now() - cacheUpdateStart}ms`
		);

		const result: FetchResult = {
			torrents: allTorrents,
			totalCount: allTorrents.length,
			cacheHit: false,
		};
		console.log(
			`[${new Date().toISOString()}] fetchRealDebridWithCache end - Total: ${Date.now() - startTime}ms`
		);
		return result;
	} catch (error) {
		console.error(`[${new Date().toISOString()}] Error fetching torrents with cache:`, error);
		throw error;
	}
}

/**
 * Clears the torrent cache
 */
export function clearTorrentCache() {
	cachedTorrents = null;
	cacheTimestamp = 0;
}

/**
 * Fetches RealDebrid torrents incrementally, calling callback for each page
 * This allows UI to update progressively as data arrives
 */
export async function fetchRealDebridIncremental(
	rdKey: string,
	onPageLoaded: IncrementalCallback,
	onProgress?: ProgressCallback
): Promise<{ totalCount: number }> {
	const startTime = Date.now();
	console.log(`[${new Date().toISOString()}] fetchRealDebridIncremental start`);

	const pageSize = 1500; // Optimal balance: ~2.7s per page through proxy
	const allTorrents: UserTorrent[] = [];

	// Fetch first page to get total count
	const firstPageStart = Date.now();
	const { data: firstPageData, totalCount } = await getUserTorrentsList(rdKey, pageSize, 1);
	console.log(
		`[${new Date().toISOString()}]   First page: ${Date.now() - firstPageStart}ms (${firstPageData.length} items)`
	);

	if (!firstPageData.length || !totalCount || totalCount === 0) {
		return { totalCount: 0 };
	}

	// Convert and deliver first page immediately
	const firstPageTorrents = (await withOriginalRdNames(rdKey, firstPageData)).map(
		convertToUserTorrent
	);
	allTorrents.push(...firstPageTorrents);
	const maxPages = Math.ceil(totalCount / pageSize);

	onPageLoaded(firstPageTorrents, 1, maxPages);
	if (onProgress) onProgress(1, maxPages);

	if (maxPages === 1) {
		console.log(
			`[${new Date().toISOString()}] fetchRealDebridIncremental end - Total: ${Date.now() - startTime}ms`
		);
		return { totalCount: firstPageTorrents.length };
	}

	// Fetch remaining pages one by one for incremental updates
	for (let page = 2; page <= maxPages; page++) {
		const pageStart = Date.now();
		try {
			const { data } = await getUserTorrentsList(rdKey, pageSize, page);
			const pageTorrents = (await withOriginalRdNames(rdKey, data)).map(convertToUserTorrent);
			allTorrents.push(...pageTorrents);

			console.log(
				`[${new Date().toISOString()}]   Page ${page}/${maxPages}: ${Date.now() - pageStart}ms (${data.length} items)`
			);

			onPageLoaded(pageTorrents, page, maxPages);
			if (onProgress) onProgress(page, maxPages);
		} catch (error) {
			console.error(`[${new Date().toISOString()}] Error fetching page ${page}:`, error);
		}
	}

	// Update cache with all data
	cachedTorrents = allTorrents;
	cacheTimestamp = Date.now();

	console.log(
		`[${new Date().toISOString()}] fetchRealDebridIncremental end - Total: ${Date.now() - startTime}ms`
	);
	return { totalCount: allTorrents.length };
}
