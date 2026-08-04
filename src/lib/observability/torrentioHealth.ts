// Torrentio health check module.
// Fetches popular movies from MDBList, then for each:
// 1. Fetches the stream manifest from Torrentio
// 2. Picks a random torrent and tests the resolve endpoint
// Health checks are triggered by cron job alongside the stream health check.
// Uses Tor proxy to avoid Cloudflare blocking.

import { repository } from '@/services/repository';
import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';

const REQUEST_TIMEOUT_MS = 10000;
const TOR_MAX_RETRIES = 3;
const MDBLIST_URL = 'https://mdblist.com/lists/linaspurinis/imdb-moviemeter-top-100/json/';
const NUM_TESTS_WANTED = 3; // Number of successful movie tests we want
const MAX_MOVIE_ATTEMPTS = 10; // Max movies to try per test slot

/**
 * Creates a Tor SOCKS proxy agent for requests to Torrentio.
 * Uses a unique username per request to get a fresh circuit.
 */
function getTorAgent(): SocksProxyAgent {
	return new SocksProxyAgent(
		`socks5h://${Date.now()}-${Math.random().toString(36)}:any_password@${process.env.PROXY || 'localhost:9050'}`,
		{ timeout: REQUEST_TIMEOUT_MS }
	);
}

/**
 * Verifies a Tor agent is working by checking ipify.org.
 * (ipinfo.io blocks Tor exit nodes, so we use ipify.org instead)
 * Returns the IP if successful, null if failed.
 */
async function verifyTorAgent(agent: SocksProxyAgent): Promise<string | null> {
	try {
		const response = await axios.get<{ ip: string }>('https://api.ipify.org?format=json', {
			httpAgent: agent,
			httpsAgent: agent,
			timeout: 5000,
		});
		return response.data.ip || null;
	} catch {
		return null;
	}
}

/**
 * Gets a working Tor agent by trying new circuits until one works.
 * Returns the agent and the IP it's using, or null if all retries failed.
 */
async function getWorkingTorAgent(): Promise<{ agent: SocksProxyAgent; ip: string } | null> {
	for (let i = 0; i < TOR_MAX_RETRIES; i++) {
		const agent = getTorAgent();
		const ip = await verifyTorAgent(agent);
		if (ip) {
			console.log(`[TorrentioHealth] Tor circuit working, IP: ${ip}`);
			return { agent, ip };
		}
		console.warn(
			`[TorrentioHealth] Tor circuit ${i + 1}/${TOR_MAX_RETRIES} failed, retrying...`
		);
	}
	console.error('[TorrentioHealth] All Tor circuits failed');
	return null;
}

// Track if a check is currently running (to prevent concurrent runs)
let checkInProgress = false;

export interface TorrentioUrlCheckResult {
	url: string;
	ok: boolean;
	status: number | null;
	hasLocation: boolean;
	locationValid: boolean;
	latencyMs: number | null;
	error: string | null;
}

export interface TorrentioCheckResultData {
	ok: boolean;
	latencyMs: number | null;
	error: string | null;
	urls: TorrentioUrlCheckResult[];
	checkedAt: Date;
}

export interface TorrentioTestUrl {
	url: string;
	expectedStatus: number;
}

interface TorrentioStream {
	infoHash: string;
	fileIdx: number;
	behaviorHints?: {
		filename?: string;
	};
	title?: string;
}

interface TorrentioManifestResponse {
	streams?: TorrentioStream[];
}

interface MdbListMovie {
	id: number;
	rank: number;
	title: string;
	imdb_id: string;
	mediatype: string;
	release_year: number;
}

// Fallback movies if MDBList API fails
const FALLBACK_MOVIES: TestMovie[] = [
	{ imdbId: 'tt0816692', name: 'Interstellar' },
	{ imdbId: 'tt0241527', name: 'Harry Potter' },
	{ imdbId: 'tt0120737', name: 'Lord of the Rings' },
];

interface TestMovie {
	imdbId: string;
	name: string;
}

/**
 * Fetches popular movies from MDBList (shuffled).
 * Returns all valid movies so we can try alternatives if some have no streams.
 * Falls back to hardcoded movies if the API fails.
 */
async function getTestMovies(): Promise<TestMovie[]> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	try {
		const response = await fetch(MDBLIST_URL, {
			method: 'GET',
			signal: controller.signal,
		});
		clearTimeout(timeoutId);

		if (!response.ok) {
			console.warn('[TorrentioHealth] MDBList API returned non-OK status, using fallback');
			return FALLBACK_MOVIES;
		}

		const movies = (await response.json()) as MdbListMovie[];
		if (!Array.isArray(movies) || movies.length === 0) {
			console.warn('[TorrentioHealth] MDBList returned empty list, using fallback');
			return FALLBACK_MOVIES;
		}

		// Filter to only movies with valid IMDB IDs
		const validMovies = movies.filter(
			(m) => m.mediatype === 'movie' && m.imdb_id && m.imdb_id.startsWith('tt')
		);

		if (validMovies.length < NUM_TESTS_WANTED) {
			console.warn('[TorrentioHealth] Not enough valid movies from MDBList, using fallback');
			return FALLBACK_MOVIES;
		}

		// Shuffle and return all valid movies (we'll pick from them during testing).
		// A `sort(() => Math.random() - 0.5)` comparator is not a uniform shuffle -
		// it left the sample heavily biased toward the same titles every run - so
		// this is a Fisher-Yates pass over a copy.
		const shuffled = [...validMovies];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}

		return shuffled.map((m) => ({
			imdbId: m.imdb_id,
			name: m.title,
		}));
	} catch (error) {
		clearTimeout(timeoutId);
		console.warn('[TorrentioHealth] Failed to fetch from MDBList, using fallback:', error);
		return FALLBACK_MOVIES;
	}
}

/**
 * Fetches the stream manifest for a movie and returns a random stream.
 * Uses provided Tor proxy agent to avoid Cloudflare blocking.
 */
async function fetchRandomStreamFromManifest(
	imdbId: string,
	torAgent: SocksProxyAgent
): Promise<{ stream: TorrentioStream } | null> {
	const url = `https://torrentio.strem.fun/stream/movie/${imdbId}.json`;

	try {
		const response = await axios.get<TorrentioManifestResponse>(url, {
			httpAgent: torAgent,
			httpsAgent: torAgent,
			timeout: REQUEST_TIMEOUT_MS,
			headers: {
				'user-agent':
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
			},
		});

		const data = response.data;
		if (!data.streams || data.streams.length === 0) {
			return null;
		}

		// Pick a random stream from the available ones
		const randomIndex = Math.floor(Math.random() * data.streams.length);
		return { stream: data.streams[randomIndex] };
	} catch {
		return null;
	}
}

/**
 * Builds the resolve URL from a stream.
 */
function buildResolveUrl(rdKey: string, stream: TorrentioStream): string {
	const filename = stream.behaviorHints?.filename || stream.title || `file_${stream.fileIdx}`;
	const encodedFilename = encodeURIComponent(filename);
	return `https://torrentio.strem.fun/resolve/realdebrid/${rdKey}/${stream.infoHash}/null/${stream.fileIdx}/${encodedFilename}`;
}

/**
 * Tests a single Torrentio URL with a HEAD request via Tor proxy.
 * Success conditions:
 * - Expected status matches (200 for stream manifests, 302 for resolve URLs)
 * - For 302: location header must contain "real-debrid"
 * - Any 4xx response (service is up, just blocking our IP - not a failure)
 * Failure conditions:
 * - 5xx server errors
 * - Network/timeout errors
 */
async function testTorrentioUrl(
	testUrl: TorrentioTestUrl,
	torAgent: SocksProxyAgent
): Promise<TorrentioUrlCheckResult> {
	const { url, expectedStatus } = testUrl;
	const startTime = performance.now();

	try {
		const response = await axios.head(url, {
			httpAgent: torAgent,
			httpsAgent: torAgent,
			timeout: REQUEST_TIMEOUT_MS,
			maxRedirects: 0, // Don't follow redirects, we want to check the 302
			validateStatus: () => true, // Accept any status code
			headers: {
				'user-agent':
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
			},
		});
		const endTime = performance.now();

		const status = response.status;
		const location = response.headers['location'] as string | undefined;
		const hasLocation = !!location && location.length > 0;
		const locationValid = hasLocation && location.toLowerCase().includes('real-debrid');

		// Success cases:
		// 1. HTTP 200 for stream manifest URLs
		// 2. HTTP 302 with valid real-debrid location for resolve URLs
		// 3. Any 4xx response means Torrentio is responding (just blocking us)
		const isExpectedResponse =
			expectedStatus === 200 ? status === 200 : status === 302 && locationValid;
		const is4xxResponse = status >= 400 && status < 500;
		const ok = isExpectedResponse || is4xxResponse;

		return {
			url,
			ok,
			status,
			hasLocation,
			locationValid,
			latencyMs: endTime - startTime,
			error: ok
				? null
				: status >= 500
					? `Server error: ${status}`
					: `Unexpected response: ${status}`,
		};
	} catch (error) {
		const endTime = performance.now();

		let errorMessage = 'Unknown error';
		if (axios.isAxiosError(error)) {
			errorMessage = error.code === 'ECONNABORTED' ? 'Timeout' : error.message;
		} else if (error instanceof Error) {
			errorMessage = error.message;
		}

		return {
			url,
			ok: false,
			status: null,
			hasLocation: false,
			locationValid: false,
			latencyMs: endTime - startTime,
			error: errorMessage,
		};
	}
}

/**
 * Runs the Torrentio health check.
 * For each test movie:
 * 1. Fetches the stream manifest (tests manifest endpoint)
 * 2. Picks a random torrent from the results
 * 3. Tests the resolve URL for that torrent (tests resolve endpoint)
 * Returns true only if all checks pass.
 */
async function runTorrentioCheck(rdKey: string): Promise<{
	ok: boolean;
	latencyMs: number | null;
	error: string | null;
	urls: TorrentioUrlCheckResult[];
}> {
	const allResults: TorrentioUrlCheckResult[] = [];

	// Get a working Tor agent first
	const torResult = await getWorkingTorAgent();
	if (!torResult) {
		return {
			ok: false,
			latencyMs: null,
			error: 'All Tor circuits failed',
			urls: [],
		};
	}
	const { agent: torAgent } = torResult;

	// Fetch test movies from MDBList (or use fallback)
	const availableMovies = await getTestMovies();
	let movieIndex = 0;
	let successfulTests = 0;
	const testedMovies: string[] = [];

	// Try to get NUM_TESTS_WANTED successful tests, trying alternative movies if some have no streams
	while (successfulTests < NUM_TESTS_WANTED && movieIndex < availableMovies.length) {
		const movie = availableMovies[movieIndex];
		movieIndex++;

		const manifestUrl = `https://torrentio.strem.fun/stream/movie/${movie.imdbId}.json`;
		const startTime = performance.now();
		const manifestResult = await fetchRandomStreamFromManifest(movie.imdbId, torAgent);
		const manifestLatency = performance.now() - startTime;

		if (!manifestResult) {
			// Movie has no streams or fetch failed - try another movie
			// Only log if we've tried many movies for this slot
			if (movieIndex > successfulTests * MAX_MOVIE_ATTEMPTS) {
				console.warn(
					`[TorrentioHealth] ${movie.name} has no streams, tried ${movieIndex - successfulTests * MAX_MOVIE_ATTEMPTS} movies for slot ${successfulTests + 1}`
				);
			}
			continue;
		}

		// Manifest succeeded - record it
		testedMovies.push(movie.name);
		allResults.push({
			url: manifestUrl,
			ok: true,
			status: 200,
			hasLocation: false,
			locationValid: false,
			latencyMs: manifestLatency,
			error: null,
		});

		// Now test the resolve URL for the randomly picked torrent
		const resolveUrl = buildResolveUrl(rdKey, manifestResult.stream);
		const resolveResult = await testTorrentioUrl(
			{ url: resolveUrl, expectedStatus: 302 },
			torAgent
		);
		allResults.push(resolveResult);
		successfulTests++;
	}

	if (testedMovies.length > 0) {
		console.log(`[TorrentioHealth] Testing with movies: ${testedMovies.join(', ')}`);
	}

	// If we couldn't get any successful tests, that's a failure
	if (successfulTests === 0) {
		return {
			ok: false,
			latencyMs: null,
			error: `No movies with streams found after trying ${movieIndex} movies`,
			urls: [],
		};
	}

	const allOk = allResults.every((r) => r.ok);
	const resultsWithLatency = allResults.filter((r) => r.latencyMs !== null);

	// Calculate average latency of all checks that got a response
	let avgLatencyMs: number | null = null;
	if (resultsWithLatency.length > 0) {
		const totalLatency = resultsWithLatency.reduce((sum, r) => sum + (r.latencyMs ?? 0), 0);
		avgLatencyMs = totalLatency / resultsWithLatency.length;
	}

	// Build error message if any failed
	let error: string | null = null;
	if (!allOk) {
		const failedUrls = allResults.filter((r) => !r.ok);
		error = failedUrls.map((r) => r.error).join('; ');
	}

	return {
		ok: allOk,
		latencyMs: avgLatencyMs,
		error,
		urls: allResults,
	};
}

/**
 * Executes a Torrentio health check. Called by cron job.
 */
async function executeCheck(): Promise<void> {
	if (checkInProgress) {
		console.log('[TorrentioHealth] Check already in progress, skipping');
		return;
	}

	const rdKey = process.env.REALDEBRID_KEY;
	if (!rdKey) {
		console.warn('[TorrentioHealth] REALDEBRID_KEY not set, skipping check');
		return;
	}

	checkInProgress = true;
	try {
		const result = await runTorrentioCheck(rdKey);

		// Record individual check result
		await repository.recordTorrentioCheckResult({
			ok: result.ok,
			latencyMs: result.latencyMs,
			error: result.error,
			urls: result.urls,
		});

		// Record to hourly aggregates for historical charts
		await repository.recordTorrentioHealthSnapshot({
			ok: result.ok,
			latencyMs: result.latencyMs,
		});

		console.log(
			`[TorrentioHealth] Check complete: ${result.ok ? 'PASS' : 'FAIL'}${
				result.latencyMs ? ` (${Math.round(result.latencyMs)}ms avg)` : ''
			}`
		);
	} catch (error) {
		console.error('[TorrentioHealth] Check failed:', error);
	} finally {
		checkInProgress = false;
	}
}

/**
 * Checks if a health check is currently in progress.
 */
export function isTorrentioHealthCheckInProgress(): boolean {
	return checkInProgress;
}

/**
 * Runs the Torrentio health check immediately (on-demand).
 * Called by cron job endpoint.
 */
export async function runTorrentioHealthCheckNow(): Promise<void> {
	await executeCheck();
}

/**
 * Gets recent Torrentio check results from the database.
 */
export async function getRecentTorrentioChecks(limit = 5): Promise<TorrentioCheckResultData[]> {
	return repository.getRecentTorrentioChecks(limit);
}

export const __testing = {
	reset() {
		checkInProgress = false;
	},
	async runNow() {
		return runTorrentioHealthCheckNow();
	},
	FALLBACK_MOVIES,
	MDBLIST_URL,
	getTestMovies,
	fetchRandomStreamFromManifest,
	buildResolveUrl,
	testTorrentioUrl,
};
