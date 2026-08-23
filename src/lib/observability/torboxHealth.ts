// TorBox health check module.
//
// Every signal that decides the verdict comes from an *unauthenticated* TorBox
// endpoint, on purpose. The Real-Debrid page routes its whole verdict through
// one account's key and one stored /d/ link, so a revoked key or an expired
// link reads as "Real-Debrid is down" for every visitor. TorBox publishes
// enough without auth to avoid that:
//
//   GET /                                -> is the API answering at all
//   GET /v1/api/stats                    -> service-wide scale (users, servers)
//   GET /v1/api/speedtest?test_length=.. -> the live CDN node list, per region
//
// Each advertised CDN node then gets a `Range: bytes=0-0` read of its 100MB
// test file. Per CLAUDE.md a ranged read is the only probe that actually
// settles whether TorBox will serve bytes - reachability of the API says
// nothing about the data path.
//
// The authenticated probe (user/me + checkcached) is supplementary and never
// decides the verdict: a rejected key means *this* key is bad, not that TorBox
// is down for anyone else.
//
// Health checks are triggered by the cron endpoint, not an in-memory scheduler.

import type { TorBoxAuthState, TorBoxCdnNodeStatus } from '@/services/database/torboxHealth';
import { repository } from '@/services/repository';

const API_BASE = 'https://api.torbox.app';
const API_VERSION = 'v1';
const API_TIMEOUT_MS = 10000;
const NODE_TIMEOUT_MS = 8000;

// Big Buck Bunny - public domain, and checkcached is a genuinely
// non-destructive probe: it adds nothing to the account. The probe passes on
// the endpoint answering, not on the hash being cached; TorBox returns
// `success:true` with an empty `data` for a miss, so a cache eviction here
// never turns into a false outage.
const CACHE_PROBE_HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';

let checkInProgress = false;

export interface TorBoxApiPingResult {
	ok: boolean;
	latencyMs: number | null;
	detail: string | null;
	error: string | null;
}

export interface TorBoxServiceStats {
	totalUsers: number | null;
	totalServers: number | null;
}

export interface TorBoxCdnNode {
	host: string;
	region: string;
	name: string;
	url: string;
}

export interface TorBoxAuthResult {
	state: TorBoxAuthState;
	error: string | null;
	/**
	 * TorBox can carry a `cooldown_until` far into the future while every
	 * endpoint still answers normally - see CLAUDE.md. It is reported for
	 * context and deliberately does not affect `state`.
	 */
	cooldownUntil: string | null;
}

interface TorBoxEnvelope<T> {
	success?: boolean;
	error?: unknown;
	detail?: string;
	data?: T;
}

/**
 * TorBox answers application failures with HTTP 200 and `success:false`, so
 * `response.ok` proves nothing on its own. Every read goes through here.
 */
async function readEnvelope<T>(
	url: string,
	init: RequestInit,
	timeoutMs: number
): Promise<
	| { ok: true; envelope: TorBoxEnvelope<T>; status: number; latencyMs: number }
	| { ok: false; error: string; status: number | null; latencyMs: number | null }
> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
	const startedAt = performance.now();

	try {
		const response = await fetch(url, { ...init, signal: controller.signal });
		const latencyMs = performance.now() - startedAt;
		clearTimeout(timeoutId);

		let envelope: TorBoxEnvelope<T>;
		try {
			envelope = (await response.json()) as TorBoxEnvelope<T>;
		} catch {
			return {
				ok: false,
				error: `HTTP ${response.status} (unparseable body)`,
				status: response.status,
				latencyMs,
			};
		}

		if (!response.ok) {
			return {
				ok: false,
				error: describeEnvelopeError(envelope) ?? `HTTP ${response.status}`,
				status: response.status,
				latencyMs,
			};
		}

		if (envelope.success === false) {
			return {
				ok: false,
				error: describeEnvelopeError(envelope) ?? 'TorBox reported success:false',
				status: response.status,
				latencyMs,
			};
		}

		return { ok: true, envelope, status: response.status, latencyMs };
	} catch (error) {
		clearTimeout(timeoutId);
		return {
			ok: false,
			error: describeFetchError(error),
			status: null,
			latencyMs: null,
		};
	}
}

function describeEnvelopeError(envelope: TorBoxEnvelope<unknown>): string | null {
	if (typeof envelope.error === 'string' && envelope.error.length > 0) {
		return envelope.detail ? `${envelope.error}: ${envelope.detail}` : envelope.error;
	}
	if (typeof envelope.detail === 'string' && envelope.detail.length > 0) {
		return envelope.detail;
	}
	return null;
}

function describeFetchError(error: unknown): string {
	if (error instanceof Error) {
		return error.name === 'AbortError' ? 'Timeout' : error.message;
	}
	return 'Unknown error';
}

/**
 * Pings the unauthenticated API root. `detail` sometimes carries a downtime
 * notice, so it is kept and shown rather than discarded.
 */
export async function pingApi(): Promise<TorBoxApiPingResult> {
	const result = await readEnvelope<null>(`${API_BASE}/`, { method: 'GET' }, API_TIMEOUT_MS);

	if (!result.ok) {
		return { ok: false, latencyMs: result.latencyMs, detail: null, error: result.error };
	}

	return {
		ok: true,
		latencyMs: result.latencyMs,
		detail: result.envelope.detail ?? null,
		error: null,
	};
}

/**
 * Service-wide counts from the public stats endpoint. Context for the reader,
 * never part of the verdict.
 */
export async function fetchServiceStats(): Promise<TorBoxServiceStats | null> {
	const result = await readEnvelope<{ total_users?: number; total_servers?: number }>(
		`${API_BASE}/${API_VERSION}/api/stats`,
		{ method: 'GET' },
		API_TIMEOUT_MS
	);

	if (!result.ok) return null;

	const data = result.envelope.data ?? {};
	return {
		totalUsers: typeof data.total_users === 'number' ? data.total_users : null,
		totalServers: typeof data.total_servers === 'number' ? data.total_servers : null,
	};
}

/**
 * Asks TorBox which CDN nodes exist right now. The list is regional and moves
 * as TorBox adds and retires hardware, so it is never hardcoded.
 */
export async function fetchCdnNodes(): Promise<TorBoxCdnNode[]> {
	const result = await readEnvelope<
		Array<{ region?: string; name?: string; url?: string; domain?: string }>
	>(
		`${API_BASE}/${API_VERSION}/api/speedtest?test_length=short`,
		{ method: 'GET' },
		API_TIMEOUT_MS
	);

	if (!result.ok) {
		console.error('[TorBoxHealth] Failed to fetch CDN node list:', result.error);
		return [];
	}

	const data = result.envelope.data;
	if (!Array.isArray(data)) return [];

	const nodes: TorBoxCdnNode[] = [];
	for (const entry of data) {
		if (!entry?.url || !entry.region) continue;

		let host: string;
		try {
			host = new URL(entry.url).host;
		} catch {
			continue;
		}

		nodes.push({
			host,
			region: entry.region,
			name: entry.name ?? host.split('.')[0],
			url: entry.url,
		});
	}

	// One entry per region: TorBox returns a single node per region today, but
	// deduping keeps a future multi-node response from double-counting a region.
	const perRegion = new Map<string, TorBoxCdnNode>();
	for (const node of nodes) {
		if (!perRegion.has(node.region)) perRegion.set(node.region, node);
	}

	return Array.from(perRegion.values());
}

/**
 * Reads the first byte of a node's test file. Only a 206 with a byte counts:
 * a 200 means the node ignored Range and would have sent 100MB.
 */
export async function testCdnNode(node: TorBoxCdnNode): Promise<TorBoxCdnNodeStatus> {
	const checkedAt = new Date();
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), NODE_TIMEOUT_MS);
	const startedAt = performance.now();

	const base = { host: node.host, region: node.region, name: node.name, checkedAt };

	try {
		const response = await fetch(node.url, {
			method: 'GET',
			headers: { Range: 'bytes=0-0' },
			signal: controller.signal,
		});
		const latencyMs = performance.now() - startedAt;
		clearTimeout(timeoutId);

		// Drain the single byte so the connection can be reused rather than
		// left hanging on an unread body.
		await response.arrayBuffer().catch(() => undefined);

		if (response.status === 206) {
			return { ...base, status: 206, latencyMs, ok: true, error: null };
		}

		return {
			...base,
			status: response.status,
			latencyMs: null,
			ok: false,
			error: response.status === 200 ? 'HTTP 200 (Range ignored)' : `HTTP ${response.status}`,
		};
	} catch (error) {
		clearTimeout(timeoutId);
		return {
			...base,
			status: null,
			latencyMs: null,
			ok: false,
			error: describeFetchError(error),
		};
	}
}

/**
 * Exercises the authenticated surface with the operator's key: identity first,
 * then a cache lookup. Returns `skipped` when no key is configured - that is a
 * supported deployment, not a failure.
 */
export async function checkAuthenticatedApi(apiKey: string | undefined): Promise<TorBoxAuthResult> {
	if (!apiKey) {
		return { state: 'skipped', error: null, cooldownUntil: null };
	}

	const headers = { Authorization: `Bearer ${apiKey}` };

	const me = await readEnvelope<{ cooldown_until?: string | null }>(
		`${API_BASE}/${API_VERSION}/api/user/me?settings=false`,
		{ method: 'GET', headers },
		API_TIMEOUT_MS
	);

	if (!me.ok) {
		// A rotated or revoked key answers AUTH_ERROR on every endpoint. That is
		// a credential problem on our side and must not read as a TorBox outage.
		const isAuthError = /AUTH_ERROR|HTTP 401|HTTP 403/i.test(me.error);
		return {
			state: isAuthError ? 'credentials' : 'failed',
			error: me.error,
			cooldownUntil: null,
		};
	}

	const cooldownUntil = me.envelope.data?.cooldown_until ?? null;

	const cached = await readEnvelope<unknown>(
		`${API_BASE}/${API_VERSION}/api/torrents/checkcached?hash=${CACHE_PROBE_HASH}&format=object&list_files=false`,
		{ method: 'GET', headers },
		API_TIMEOUT_MS
	);

	if (!cached.ok) {
		const isAuthError = /AUTH_ERROR|HTTP 401|HTTP 403/i.test(cached.error);
		return {
			state: isAuthError ? 'credentials' : 'failed',
			error: cached.error,
			cooldownUntil,
		};
	}

	return { state: 'ok', error: null, cooldownUntil };
}

/**
 * Runs one full check and persists it.
 */
async function executeCheck(): Promise<void> {
	if (checkInProgress) {
		console.log('[TorBoxHealth] Check already in progress, skipping');
		return;
	}

	checkInProgress = true;
	try {
		const [api, nodes] = await Promise.all([pingApi(), fetchCdnNodes()]);

		const statuses =
			nodes.length > 0 ? await Promise.all(nodes.map((node) => testCdnNode(node))) : [];

		const auth = await checkAuthenticatedApi(process.env.TORBOX_KEY);

		// Node discovery failing must not wipe the table - the previous run's
		// statuses are better than nothing, and an empty table would read as a
		// total outage on the page.
		if (statuses.length > 0) {
			await repository.deleteDeprecatedTorBoxNodes(statuses.map((s) => s.host));
			await repository.upsertTorBoxCdnResults(statuses);
		} else {
			console.warn('[TorBoxHealth] No CDN nodes discovered, keeping previous statuses');
		}

		const working = statuses.filter((s) => s.ok);
		const latencies = working.map((s) => s.latencyMs).filter((l): l is number => l !== null);
		const fastest = working.reduce<TorBoxCdnNodeStatus | null>(
			(best, current) =>
				current.latencyMs !== null &&
				(best === null || best.latencyMs === null || current.latencyMs < best.latencyMs)
					? current
					: best,
			null
		);

		await repository.recordTorBoxCheckResult({
			apiOk: api.ok,
			apiLatencyMs: api.latencyMs,
			apiDetail: api.detail ?? api.error,
			authState: auth.state,
			authError: auth.error,
			totalNodes: statuses.length,
			workingNodes: working.length,
		});

		if (statuses.length > 0) {
			await repository.recordTorBoxHealthSnapshot({
				totalNodes: statuses.length,
				workingNodes: working.length,
				apiOk: api.ok,
				avgLatencyMs:
					latencies.length > 0
						? latencies.reduce((sum, l) => sum + l, 0) / latencies.length
						: null,
				minLatencyMs: latencies.length > 0 ? Math.min(...latencies) : null,
				maxLatencyMs: latencies.length > 0 ? Math.max(...latencies) : null,
				fastestNode: fastest?.host ?? null,
				failedNodes: statuses.filter((s) => !s.ok).map((s) => s.host),
			});
		}

		console.log(
			`[TorBoxHealth] Check complete: API ${api.ok ? 'up' : 'down'}, ` +
				`${working.length}/${statuses.length} CDN nodes, auth ${auth.state}`
		);
	} catch (error) {
		console.error('[TorBoxHealth] Check failed:', error);
	} finally {
		checkInProgress = false;
	}
}

export function isTorBoxHealthCheckInProgress(): boolean {
	return checkInProgress;
}

/**
 * Runs the TorBox health check immediately. Called by the cron endpoint.
 */
export async function runTorBoxHealthCheckNow(): Promise<void> {
	await executeCheck();
}

export const __testing = {
	reset() {
		checkInProgress = false;
	},
	executeCheck,
	API_BASE,
	CACHE_PROBE_HASH,
};
