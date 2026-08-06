// The debrid uploader runs on one or more servers (debrid01, debrid02, …). Each
// server generates its own job IDs and only knows its own jobs, so a job is
// pinned to the server that created it: status polls, the files fetch and delete
// must all go back to that same server.
//
// Configure with DEBRID_UPLOADER_URLS (comma-separated) for a pool, or the single
// DEBRID_UPLOADER_URL for one. Unset falls back to the debrid02 default, so
// existing single-server deployments behave exactly as before.
//
// Each entry may carry a `;maxGb=N` cap for an underpowered box, e.g.
//   DEBRID_UPLOADER_URLS=http://debrid01:3100;maxGb=10,http://debrid02:3100
// A job larger than a server's cap is never routed there — rewriteTorrent is
// synchronous, so one big torrent stalls a single-core host and its webseed
// serving. Uncapped servers take any size.
const DEFAULT_SERVER = 'http://138.201.246.20:3100';

export interface DebridServerConfig {
	url: string;
	maxBytes?: number;
}

function parseServerConfigs(): DebridServerConfig[] {
	const list = process.env.DEBRID_UPLOADER_URLS;
	const entries =
		list && list.trim() ? list.split(',') : [process.env.DEBRID_UPLOADER_URL || DEFAULT_SERVER];

	const configs: DebridServerConfig[] = [];
	for (const entry of entries) {
		const parts = entry.split(';').map((s) => s.trim());
		const url = (parts[0] || '').replace(/\/+$/, '');
		if (!url) continue;
		let maxBytes: number | undefined;
		for (const opt of parts.slice(1)) {
			const m = opt.match(/^maxgb=([\d.]+)$/i);
			if (m) maxBytes = Math.round(parseFloat(m[1]) * 1024 ** 3);
		}
		configs.push({ url, maxBytes });
	}
	return configs.length > 0 ? configs : [{ url: DEFAULT_SERVER }];
}

export function getDebridUploaderServers(): string[] {
	return parseServerConfigs().map((c) => c.url);
}

export function isAllowedServer(url: string): boolean {
	return getDebridUploaderServers().includes(url);
}

// Round-robin cursor, per server process. All instances start at the same point,
// but each advances independently per request, so the fleet spreads jobs evenly.
let rrCursor = -1;

/**
 * The eligible servers rotated so a fresh job tries a new one first, then falls
 * back to the others (failover). A server whose `maxGb` cap is smaller than the
 * job is excluded; when the size is unknown, capped servers are skipped too (a
 * possibly-large job should never land on a limited box). Only if that leaves
 * nothing does it fall back to the full pool.
 */
export function orderedServersForNewJob(sizeBytes?: number): string[] {
	const configs = parseServerConfigs();
	const eligible = configs.filter((c) => {
		if (c.maxBytes === undefined) return true; // uncapped: any size
		if (sizeBytes === undefined) return false; // unknown size: avoid capped boxes
		return sizeBytes <= c.maxBytes;
	});
	const pool = (eligible.length > 0 ? eligible : configs).map((c) => c.url);
	rrCursor = (rrCursor + 1) % pool.length;
	return [...pool.slice(rrCursor), ...pool.slice(0, rrCursor)];
}

/**
 * Find which server owns a job. Prefers the recorded job→server mapping; falls
 * back to asking each server in turn (whoever answers 200 owns it) for jobs
 * created before the mapping existed or if the mapping was lost. Returns null
 * when no server claims it (or all are unreachable).
 */
export async function resolveJobServer(
	jobId: string,
	getMapped: (jobId: string) => Promise<string | null | undefined>
): Promise<string | null> {
	const servers = getDebridUploaderServers();
	if (servers.length === 1) return servers[0];

	const mapped = await getMapped(jobId).catch(() => null);
	if (mapped && servers.includes(mapped)) return mapped;

	for (const server of servers) {
		try {
			const res = await fetch(`${server}/jobs/${jobId}`, {
				headers: { Accept: 'application/json' },
				signal: AbortSignal.timeout(8000),
			});
			if (res.ok) return server;
		} catch {
			// try the next server
		}
	}
	return null;
}
