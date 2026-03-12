// Stream server health check module.
// Tests Real-Debrid location-based servers by unrestricting a link with each server's IP,
// then verifying the download URL works with a Range request.
// Pass percentage = working servers / total servers.
// All data is stored in MySQL.
// Health checks are triggered by cron job, not in-memory scheduler.

import { repository } from '@/services/repository';

const REQUEST_TIMEOUT_MS = 5000;
const UNRESTRICT_TIMEOUT_MS = 10000;
const TEST_LINK = 'https://real-debrid.com/d/H757DI7ELP4NC';
const RD_API_BASE = 'https://api.real-debrid.com/rest/1.0';
const SERVERS_LIST_URL =
	'https://nzimhzbfnannoxumremm.supabase.co/storage/v1/object/public/public-files/servers.txt';

// Track if a check is currently running (to prevent concurrent runs)
let checkInProgress = false;

export interface WorkingStreamServerStatus {
	id: string;
	url: string;
	status: number | null;
	contentLength: number | null;
	ok: boolean;
	checkedAt: number;
	error: string | null;
	latencyMs: number | null;
}

/**
 * Extracts the location base and instance number from a server prefix.
 * e.g. "chi1" → { base: "chi", num: 1 }
 *      "rbx"  → { base: "rbx", num: 0 }
 * Returns null for non-location servers (purely numeric like "20", "21").
 */
function parseServerPrefix(prefix: string): { base: string; num: number } | null {
	// Location servers start with letters: "chi1", "akl1", "rbx"
	const match = prefix.match(/^([a-z]+)(\d+)?$/);
	if (!match) return null; // Purely numeric like "20", "86", "100"
	return { base: match[1], num: match[2] ? parseInt(match[2], 10) : 0 };
}

/**
 * From a list of servers, picks the lowest-numbered instance per location.
 * e.g. chi1, chi2, chi3 → only chi1; lax1, lax2 → only lax1
 */
function pickLowestPerLocation(
	servers: Array<{ id: string; host: string; ip: string }>
): Array<{ id: string; host: string; ip: string }> {
	const bestPerLocation = new Map<string, { server: (typeof servers)[0]; num: number }>();

	for (const server of servers) {
		// Extract prefix before "-4.download..."
		const prefix = server.host.split('-4.')[0];
		if (!prefix) continue;

		const parsed = parseServerPrefix(prefix);
		if (!parsed) continue; // Skip non-location servers (purely numeric)

		const { base, num } = parsed;
		const existing = bestPerLocation.get(base);

		if (!existing || num < existing.num) {
			bestPerLocation.set(base, { server, num });
		}
	}

	return Array.from(bestPerLocation.values()).map((entry) => entry.server);
}

/**
 * Fetches the server list from the remote servers.txt file.
 * Parses lines like "akl1-4.download.real-debrid.com|79.127.173.209"
 * Only includes IPv4 entries (host containing -4).
 * Picks the lowest-numbered instance per location (e.g. chi1 over chi2).
 */
async function fetchServerList(): Promise<Array<{ id: string; host: string; ip: string }>> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	try {
		const response = await fetch(SERVERS_LIST_URL, { signal: controller.signal });
		clearTimeout(timeoutId);

		if (!response.ok) {
			console.error(`[StreamHealth] Failed to fetch server list: HTTP ${response.status}`);
			return [];
		}

		const text = await response.text();
		const allServers: Array<{ id: string; host: string; ip: string }> = [];

		for (const line of text.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('generated|')) continue;

			const [host, ip] = trimmed.split('|');
			if (!host || !ip) continue;

			// Only include IPv4 entries (host contains -4)
			if (!host.includes('-4')) continue;

			allServers.push({ id: host, host, ip });
		}

		return pickLowestPerLocation(allServers);
	} catch (error) {
		clearTimeout(timeoutId);
		console.error('[StreamHealth] Failed to fetch server list:', error);
		return [];
	}
}

/**
 * Unrestricts the test link routed to a specific server IP.
 * Returns the download URL for that server.
 */
async function unrestrictForServer(
	accessToken: string,
	serverIp: string
): Promise<{ download: string } | { error: string }> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), UNRESTRICT_TIMEOUT_MS);

	try {
		const params = new URLSearchParams();
		params.append('link', TEST_LINK);
		params.append('ip', serverIp);

		const response = await fetch(`${RD_API_BASE}/unrestrict/link`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Authorization: `Bearer ${accessToken}`,
			},
			body: params.toString(),
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			return { error: `Unrestrict HTTP ${response.status}` };
		}

		const data = (await response.json()) as { download: string };
		return { download: data.download };
	} catch (error) {
		clearTimeout(timeoutId);
		if (error instanceof Error && error.name === 'AbortError') {
			return { error: 'Unrestrict timeout' };
		}
		return { error: error instanceof Error ? error.message : 'Unknown unrestrict error' };
	}
}

/**
 * Tests a single server by unrestricting a link routed to its IP,
 * then making a Range request against the download URL.
 */
async function testServer(
	server: { id: string; host: string; ip: string },
	accessToken: string
): Promise<WorkingStreamServerStatus> {
	const checkedAt = Date.now();

	// Step 1: Unrestrict to get a download URL routed to this server
	const unrestrictResult = await unrestrictForServer(accessToken, server.ip);
	if ('error' in unrestrictResult) {
		return {
			id: server.id,
			url: TEST_LINK,
			status: null,
			contentLength: null,
			ok: false,
			checkedAt,
			error: unrestrictResult.error,
			latencyMs: null,
		};
	}

	const downloadUrl = unrestrictResult.download;

	// Step 2: Test the download URL with a Range request
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	try {
		const startTime = performance.now();
		const response = await fetch(downloadUrl, {
			method: 'GET',
			headers: { Range: 'bytes=0-0' },
			signal: controller.signal,
		});
		const endTime = performance.now();
		clearTimeout(timeoutId);

		const status = response.status;
		const header = response.headers.get('content-length');
		const contentLength = header ? Number(header) : null;
		const latencyMs = endTime - startTime;

		if (status === 206) {
			return {
				id: server.id,
				url: downloadUrl,
				status,
				contentLength,
				ok: true,
				checkedAt,
				error: null,
				latencyMs,
			};
		}

		return {
			id: server.id,
			url: downloadUrl,
			status,
			contentLength,
			ok: false,
			checkedAt,
			error: status === 200 ? 'HTTP 200 (Range ignored)' : `HTTP ${status}`,
			latencyMs: null,
		};
	} catch (error) {
		clearTimeout(timeoutId);
		const errorMsg =
			error instanceof Error
				? error.name === 'AbortError'
					? 'Timeout'
					: error.message
				: 'Unknown error';

		return {
			id: server.id,
			url: downloadUrl,
			status: null,
			contentLength: null,
			ok: false,
			checkedAt,
			error: errorMsg,
			latencyMs: null,
		};
	}
}

/**
 * Tests all servers by unrestricting a link to each server's IP and checking the download URL.
 */
async function inspectServers(): Promise<WorkingStreamServerStatus[]> {
	const accessToken = process.env.REALDEBRID_KEY;
	if (!accessToken) {
		console.error('[StreamHealth] REALDEBRID_KEY not set, skipping health check');
		return [];
	}

	const servers = await fetchServerList();
	if (servers.length === 0) {
		console.error('[StreamHealth] No servers found, skipping health check');
		return [];
	}

	console.log(`[StreamHealth] Testing ${servers.length} servers via unrestrict`);

	const results = await Promise.all(servers.map((server) => testServer(server, accessToken)));

	return results;
}

/**
 * Executes a health check. Called by cron job.
 */
async function executeCheck(): Promise<void> {
	if (checkInProgress) {
		console.log('[StreamHealth] Check already in progress, skipping');
		return;
	}

	checkInProgress = true;
	try {
		const statuses = await inspectServers();
		if (statuses.length === 0) {
			console.log('[StreamHealth] No statuses to process, skipping DB updates');
			return;
		}

		const workingServers = statuses.filter((status) => status.ok);
		const working = workingServers.length;

		// Calculate average latency of working servers
		let avgLatencyMs: number | null = null;
		if (workingServers.length > 0) {
			const totalLatency = workingServers.reduce((sum, s) => sum + (s.latencyMs ?? 0), 0);
			avgLatencyMs = totalLatency / workingServers.length;
		}

		// Get fastest server (sort by latency first)
		const sortedByLatency = [...workingServers].sort(
			(a, b) => (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity)
		);
		const fastestServer = sortedByLatency[0]?.id ?? null;

		// Clean up deprecated host entries (servers no longer in our test list)
		const validHosts = statuses.map((s) => s.id);
		await repository.deleteDeprecatedStreamHosts(validHosts);
		const dbResults = statuses.map((s) => ({
			host: s.id,
			status: s.status,
			latencyMs: s.latencyMs,
			ok: s.ok,
			error: s.error,
			checkedAt: new Date(s.checkedAt),
		}));
		await repository.upsertStreamHealthResults(dbResults);

		// Record to history for 90-day tracking
		const failedServers = statuses.filter((s) => !s.ok).map((s) => s.id);
		const minLatencyMs =
			workingServers.length > 0
				? Math.min(...workingServers.map((s) => s.latencyMs ?? Infinity))
				: null;
		const maxLatencyMs =
			workingServers.length > 0
				? Math.max(...workingServers.map((s) => s.latencyMs ?? 0))
				: null;

		await repository.recordStreamHealthSnapshot({
			totalServers: statuses.length,
			workingServers: working,
			avgLatencyMs,
			minLatencyMs: minLatencyMs === Infinity ? null : minLatencyMs,
			maxLatencyMs,
			fastestServer,
			failedServers,
		});

		// Record per-server reliability
		await repository.recordServerReliability(
			statuses.map((s) => ({
				host: s.id,
				ok: s.ok,
				latencyMs: s.latencyMs,
			}))
		);

		// Record individual check result for recent checks display
		const firstStatus = statuses[0];
		if (firstStatus) {
			await repository.recordStreamCheckResult({
				ok: firstStatus.ok,
				latencyMs: firstStatus.latencyMs,
				server: firstStatus.id,
				error: firstStatus.error,
			});
		}

		console.log(`[StreamHealth] Check complete: ${working}/${statuses.length} servers working`);
	} catch (error) {
		console.error('[StreamHealth] Check failed:', error);
	} finally {
		checkInProgress = false;
	}
}

/**
 * Checks if a health check is currently in progress.
 */
export function isHealthCheckInProgress(): boolean {
	return checkInProgress;
}

/**
 * Gets stream health metrics from MySQL database.
 */
export async function getStreamMetricsFromDb() {
	return repository.getStreamHealthMetrics();
}

/**
 * Gets all stream statuses from MySQL database.
 */
export function getStreamStatusesFromDb() {
	return repository.getAllStreamStatuses();
}

/**
 * Runs the stream health check immediately (on-demand).
 * Called by cron job endpoint.
 * Returns the updated metrics after the check completes.
 */
export async function runHealthCheckNow() {
	await executeCheck();
	return repository.getStreamHealthMetrics();
}

export const __testing = {
	reset() {
		checkInProgress = false;
	},
	async runNow() {
		return runHealthCheckNow();
	},
	async fetchServers() {
		return fetchServerList();
	},
};
