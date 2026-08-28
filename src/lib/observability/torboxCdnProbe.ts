// Per-region TorBox CDN probe, run from the visitor's own browser.
//
// The page's verdict deliberately comes from real user traffic rather than a
// probe of ours - see the status-page section of CLAUDE.md. This module is not
// a return of that probe. The one that was removed ran server-side on a cron
// from a single datacentre IP, so a 429 aimed at that IP was published to every
// visitor as "TorBox is Down". Here nothing runs on a schedule and nothing is
// stored: the check fires in the reader's browser, from the reader's network,
// and answers only for them. That is literally the "or just me" half of the
// question, and it is the half the traffic counters cannot answer - they
// aggregate the API across everyone, not the byte path, and not the reader's
// own route to it.
//
//   GET /v1/api/speedtest?test_length=short -> the live CDN node list, per region
//   GET <node url> with Range: bytes=0-0    -> does that node actually serve bytes
//
// A ranged read is the only probe that settles the data path: per CLAUDE.md the
// API answering, and even `checkcached` saying yes, says nothing about whether
// TorBox will hand over bytes.
//
// Both endpoints are unauthenticated, so no key is ever in play. Their CORS
// treatment differs, and that difference is why the node list has a fallback:
// the CDN nodes send `Access-Control-Allow-Origin: *` and allow Range, so the
// measurement itself runs from any origin, but the API's allowlist is fixed at
// https://debridmediamanager.com and http://localhost:3000 and refuses anything
// else outright (measured 2026-08-28). Production reads the list straight from
// TorBox; a self-hosted or dev origin falls back to DMM's own cached copy.

const API_BASE = 'https://api.torbox.app';
const API_VERSION = 'v1';
const SPEEDTEST_PATH = `${API_VERSION}/api/speedtest?test_length=short`;
const NODE_LIST_FALLBACK_URL = '/api/observability/torbox-cdn-nodes';
const SUBMIT_URL = '/api/observability/torbox-cdn';
const NODE_LIST_TIMEOUT_MS = 10_000;
const NODE_TIMEOUT_MS = 8_000;

// Human names for the region codes TorBox returns from /api/speedtest.
const REGION_NAMES: Record<string, string> = {
	ceur: 'Central Europe',
	weur: 'Western Europe',
	neur: 'Northern Europe',
	seur: 'Southern Europe',
	nord: 'Nordics',
	slav: 'Eastern Europe',
	enam: 'Eastern North America',
	cnam: 'Central North America',
	wnam: 'Western North America',
	snam: 'Southern North America',
	latm: 'Latin America',
	apac: 'Asia-Pacific',
	japn: 'Japan',
	indi: 'India',
	zafr: 'Southern Africa',
	hare: 'Anycast (Bunny)',
	erth: 'Anycast (Cloudflare)',
};

export function regionLabel(region: string): string {
	return REGION_NAMES[region] ?? region.toUpperCase();
}

export interface TorBoxCdnNode {
	host: string;
	region: string;
	name: string;
	url: string;
	/** TorBox marks the node it believes is nearest to the caller. */
	closest: boolean;
}

export interface TorBoxCdnNodeResult extends TorBoxCdnNode {
	ok: boolean;
	status: number | null;
	latencyMs: number | null;
	error: string | null;
}

export interface TorBoxCdnProbeResult {
	nodes: TorBoxCdnNodeResult[];
	/** Set when the node list itself could not be read, so there was nothing to test. */
	discoveryError: string | null;
	checkedAt: number;
}

interface SpeedtestEntry {
	region?: unknown;
	name?: unknown;
	url?: unknown;
	closest?: unknown;
}

function describeFetchError(error: unknown): string {
	if (error instanceof Error) {
		return error.name === 'AbortError' ? 'Timeout' : error.message;
	}
	return 'Unknown error';
}

/**
 * Reads a TorBox speedtest envelope from one URL - either TorBox itself or
 * DMM's cached copy of the same body, which is why there is only one parser.
 */
async function readNodeList(
	url: string,
	signal?: AbortSignal
): Promise<{ nodes: TorBoxCdnNode[]; error: string | null }> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), NODE_LIST_TIMEOUT_MS);
	const onOuterAbort = () => controller.abort();
	signal?.addEventListener('abort', onOuterAbort);

	try {
		const response = await fetch(url, { signal: controller.signal });

		if (!response.ok) {
			return { nodes: [], error: `HTTP ${response.status}` };
		}

		// TorBox reports application failures as HTTP 200 with success:false, so
		// response.ok proves nothing on its own.
		const envelope = (await response.json()) as {
			success?: unknown;
			error?: unknown;
			detail?: unknown;
			data?: unknown;
		};

		if (envelope.success === false) {
			const detail =
				typeof envelope.error === 'string'
					? envelope.error
					: typeof envelope.detail === 'string'
						? envelope.detail
						: 'TorBox reported success:false';
			return { nodes: [], error: detail };
		}

		if (!Array.isArray(envelope.data)) {
			return { nodes: [], error: 'Unexpected response shape' };
		}

		const nodes: TorBoxCdnNode[] = [];
		for (const entry of envelope.data as SpeedtestEntry[]) {
			if (typeof entry?.url !== 'string' || typeof entry.region !== 'string') continue;

			let host: string;
			try {
				host = new URL(entry.url).host;
			} catch {
				continue;
			}

			nodes.push({
				host,
				region: entry.region,
				name: typeof entry.name === 'string' ? entry.name : host.split('.')[0],
				url: entry.url,
				closest: entry.closest === true,
			});
		}

		// One entry per region: TorBox returns a single node per region today, but
		// deduping keeps a future multi-node response from double-counting a region.
		const perRegion = new Map<string, TorBoxCdnNode>();
		for (const node of nodes) {
			if (!perRegion.has(node.region)) perRegion.set(node.region, node);
		}

		return { nodes: Array.from(perRegion.values()), error: null };
	} catch (error) {
		return { nodes: [], error: describeFetchError(error) };
	} finally {
		clearTimeout(timeoutId);
		signal?.removeEventListener('abort', onOuterAbort);
	}
}

/**
 * Asks TorBox which CDN nodes exist right now. The list is regional and moves
 * as TorBox adds and retires hardware, so it is never hardcoded.
 *
 * On the production origin the browser reads it from TorBox and DMM's servers
 * stay out of it entirely. Elsewhere TorBox's CORS allowlist refuses the origin,
 * which surfaces as a fetch failure rather than a status, so a failed read falls
 * back to DMM's cached copy of the same envelope. An empty-but-successful read
 * is not a failure and does not fall back.
 */
export async function fetchCdnNodes(
	signal?: AbortSignal
): Promise<{ nodes: TorBoxCdnNode[]; error: string | null }> {
	const direct = await readNodeList(`${API_BASE}/${SPEEDTEST_PATH}`, signal);
	if (direct.error === null || signal?.aborted) return direct;

	const proxied = await readNodeList(NODE_LIST_FALLBACK_URL, signal);
	return proxied.error === null ? proxied : direct;
}

/**
 * Reads the first byte of a node's test file. Only a 206 counts: a 200 means
 * the node ignored Range and would have sent the whole 100MB test file.
 */
export async function probeCdnNode(
	node: TorBoxCdnNode,
	signal?: AbortSignal
): Promise<TorBoxCdnNodeResult> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), NODE_TIMEOUT_MS);
	const onOuterAbort = () => controller.abort();
	signal?.addEventListener('abort', onOuterAbort);
	const startedAt = performance.now();

	try {
		const response = await fetch(node.url, {
			headers: { Range: 'bytes=0-0' },
			cache: 'no-store',
			signal: controller.signal,
		});
		const latencyMs = Math.max(0, performance.now() - startedAt);

		// Drain the single byte so the connection can be reused rather than left
		// hanging on an unread body.
		await response.arrayBuffer().catch(() => undefined);

		if (response.status === 206) {
			return { ...node, ok: true, status: 206, latencyMs, error: null };
		}

		return {
			...node,
			ok: false,
			status: response.status,
			latencyMs: null,
			error: response.status === 200 ? 'HTTP 200 (Range ignored)' : `HTTP ${response.status}`,
		};
	} catch (error) {
		return {
			...node,
			ok: false,
			status: null,
			latencyMs: null,
			error: describeFetchError(error),
		};
	} finally {
		clearTimeout(timeoutId);
		signal?.removeEventListener('abort', onOuterAbort);
	}
}

/**
 * Discovers the nodes and probes every one of them in parallel. Results keep
 * TorBox's own ordering, which puts the caller's nearest region first.
 */
export async function runCdnProbe(signal?: AbortSignal): Promise<TorBoxCdnProbeResult> {
	const { nodes, error } = await fetchCdnNodes(signal);

	if (nodes.length === 0) {
		return {
			nodes: [],
			discoveryError: error ?? 'TorBox advertised no CDN nodes',
			checkedAt: Date.now(),
		};
	}

	const nodeResults = await Promise.all(nodes.map((node) => probeCdnNode(node, signal)));
	return { nodes: nodeResults, discoveryError: null, checkedAt: Date.now() };
}

/**
 * Contributes this run to the crowd-sourced history behind the CDN chart.
 *
 * Deliberately fire-and-forget and deliberately unable to fail loudly: the
 * reader came for a status page, and a rejected or rate-limited submission must
 * not turn a working panel into an error. Latency is sent only for a region that
 * served bytes - a timeout has no latency, and averaging one in would quietly
 * report an outage as slowness.
 */
export async function submitCdnProbe(
	result: TorBoxCdnProbeResult,
	signal?: AbortSignal
): Promise<boolean> {
	if (result.nodes.length === 0) return false;

	try {
		const response = await fetch(SUBMIT_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				results: result.nodes.map((node) => ({
					region: node.region,
					ok: node.ok,
					latencyMs: node.ok ? node.latencyMs : null,
				})),
			}),
			signal,
		});
		return response.ok;
	} catch {
		return false;
	}
}
