// The two guards the `/api/scrapers/*` routes share: who may call them, and
// whether the process is allowed to tear itself down afterwards. Both exist
// because those three routes are served from two very different places — the
// four `dmm_web` swarm replicas behind debridmediamanager.com, and the throwaway
// one-shot Next instances `scraper.sh` boots on dmm-01.
import { ScrapeResponse } from '@/scrapers/scrapeJobs';
import crypto from 'crypto';
import { NextApiRequest, NextApiResponse } from 'next';

function timingSafeEquals(a: string, b: string): boolean {
	const bufferA = Buffer.from(a, 'utf-8');
	const bufferB = Buffer.from(b, 'utf-8');
	if (bufferA.length !== bufferB.length) {
		return false;
	}
	return crypto.timingSafeEqual(bufferA, bufferB);
}

/**
 * Read the presented password from either transport.
 *
 * Header and query param both, because the callers are cron entries and shell
 * scripts rather than a browser — some reach for `curl -H`, some for a bare URL.
 * The header wins when both are present so a stale URL cannot override an
 * explicitly-set header.
 */
function presentedPassword(req: NextApiRequest): string | undefined {
	// Both bags are optional-chained: Next always populates them, but a caller
	// that constructs a partial request must be refused, not crash into a 500
	// that reads like a server fault rather than a rejected password.
	const header = req.headers?.['x-scrape-password'];
	if (typeof header === 'string' && header.length > 0) {
		return header;
	}
	const query = req.query?.password;
	if (typeof query === 'string' && query.length > 0) {
		return query;
	}
	return undefined;
}

/**
 * Password gate for the three `/api/scrapers/*` routes.
 *
 * Those routes are cron- and script-triggered, never reached from the browser,
 * and each call spends real Jackett/Prowlarr and database budget — so they take
 * a shared secret rather than the availability token the browser-facing routes
 * use. `SCRAPE_API_PASSWORD` was already provisioned in the production env; up
 * to now nothing read it, which is why they answered any anonymous caller.
 *
 * Fails **closed**: with the variable unset there is nothing to compare against,
 * so every caller is refused. Falling through open on a missing env var is
 * exactly how these ended up publicly reachable.
 *
 * Writes the refusal itself and returns `false`; the caller returns immediately.
 */
export function authorizeScrapeRequest(
	req: NextApiRequest,
	res: NextApiResponse<ScrapeResponse>
): boolean {
	const expected = process.env.SCRAPE_API_PASSWORD;
	if (!expected) {
		console.error('SCRAPE_API_PASSWORD environment variable is not set');
		res.status(500).json({ status: 'error', errorMessage: 'Server configuration error' });
		return false;
	}

	const provided = presentedPassword(req);
	if (!provided || !timingSafeEquals(provided, expected)) {
		res.status(401).json({ status: 'failed' });
		return false;
	}

	return true;
}

/**
 * Tear the process down, but only if it is a one-shot scrape worker.
 *
 * `scraper.sh` on dmm-01 boots a throwaway Next instance per mdblist list on a
 * random port, curls one of these routes, and relies on this exit as that
 * worker's teardown — drop it and every scrape run leaks an orphaned Next
 * process and tmux session. But the same routes are served by the four `dmm_web`
 * swarm replicas, where exiting takes a live replica out of the load balancer.
 *
 * So the exit is opt-in: only the ephemeral worker's env sets
 * `SCRAPE_WORKER=1`. A swarm replica can never exit here, authenticated caller
 * or not.
 */
export function exitIfScrapeWorker(): void {
	if (process.env.SCRAPE_WORKER === '1') {
		process.exit(0);
	}
}
