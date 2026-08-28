import type { NextApiRequest, NextApiResponse } from 'next';

// Fallback node list for the browser-side CDN panel.
//
// TorBox's API CORS allowlist is fixed: it carries https://debridmediamanager.com
// and http://localhost:3000 and refuses every other origin outright (measured
// 2026-08-28 - localhost:3111 and example.com both come back with no
// access-control-allow-origin at all). On production the panel therefore reads
// the node list straight from TorBox and this route is never touched; on a
// self-hosted or dev origin the browser is refused and falls back here.
//
// The CDN nodes themselves send `Access-Control-Allow-Origin: *`, so the part
// that actually measures anything - the ranged read of each node - always runs
// in the reader's browser, from the reader's network, wherever DMM is hosted.
// This route only hands over a public, unauthenticated list of hostnames.
//
// It is deliberately cached and deliberately not a cron. The probe this page
// used to run hit TorBox ~5,500 times a day from one datacentre IP and got
// itself rate-limited into announcing outages that were not happening; a cached
// list fetch is at most a handful of calls an hour per instance, and nothing
// here feeds the page's verdict.

const SPEEDTEST_URL = 'https://api.torbox.app/v1/api/speedtest?test_length=short';
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

interface CachedList {
	body: unknown;
	expiresAt: number;
}

let cache: CachedList | null = null;

async function fetchNodeList(): Promise<unknown> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(SPEEDTEST_URL, { signal: controller.signal });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		return await response.json();
	} finally {
		clearTimeout(timeoutId);
	}
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const now = Date.now();
	if (cache !== null && cache.expiresAt > now) {
		res.setHeader('Cache-Control', 'public, max-age=60');
		return res.status(200).json(cache.body);
	}

	try {
		// The response is TorBox's own envelope, verbatim, so the browser parses
		// one shape whether it read the list here or straight from TorBox.
		const body = await fetchNodeList();
		cache = { body, expiresAt: now + CACHE_TTL_MS };
		res.setHeader('Cache-Control', 'public, max-age=60');
		return res.status(200).json(body);
	} catch (error) {
		console.error('Failed to fetch TorBox CDN node list:', error);
		// A stale list still names real hostnames worth probing, and the browser
		// is the thing that decides whether they serve bytes.
		if (cache !== null) {
			res.setHeader('Cache-Control', 'public, max-age=60');
			return res.status(200).json(cache.body);
		}
		return res.status(502).json({ error: 'Could not reach TorBox' });
	}
}

export const __testing = {
	reset() {
		cache = null;
	},
};
