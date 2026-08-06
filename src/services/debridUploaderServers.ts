// The debrid uploader runs on one or more servers (debrid01, debrid02, …). Each
// server generates its own job IDs and only knows its own jobs, so a job is
// pinned to the server that created it: status polls, the files fetch and delete
// must all go back to that same server.
//
// Configure with DEBRID_UPLOADER_URLS (comma-separated) for a pool, or the single
// DEBRID_UPLOADER_URL for one. Unset falls back to the debrid02 default, so
// existing single-server deployments behave exactly as before.
const DEFAULT_SERVER = 'http://138.201.246.20:3100';

export function getDebridUploaderServers(): string[] {
	const list = process.env.DEBRID_UPLOADER_URLS;
	if (list) {
		const servers = list
			.split(',')
			.map((s) => s.trim().replace(/\/+$/, ''))
			.filter(Boolean);
		if (servers.length > 0) return servers;
	}
	const single = process.env.DEBRID_UPLOADER_URL;
	return [(single || DEFAULT_SERVER).replace(/\/+$/, '')];
}

export function isAllowedServer(url: string): boolean {
	return getDebridUploaderServers().includes(url);
}

// Round-robin cursor, per server process. All instances start at the same point,
// but each advances independently per request, so the fleet spreads jobs evenly.
let rrCursor = -1;

/** The full server list rotated so a fresh job tries a new server first, then
 *  falls back to the others (failover) if that one is unreachable. */
export function orderedServersForNewJob(): string[] {
	const servers = getDebridUploaderServers();
	rrCursor = (rrCursor + 1) % servers.length;
	return [...servers.slice(rrCursor), ...servers.slice(0, rrCursor)];
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
