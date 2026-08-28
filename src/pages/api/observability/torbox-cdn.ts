import type { TorBoxCdnSample } from '@/services/database/torboxCdn';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import type { NextApiRequest, NextApiResponse } from 'next';

// Where the status page's CDN history comes from.
//
// The panel probes tb-cdn in the reader's own browser; this is the only way
// those results can become a time series, because DMM's servers never touch
// tb-cdn themselves and must not start - a probe from one datacentre IP
// measures that IP's rate-limit standing, which is exactly the mistake the
// removed cron made. Many readers on many networks is the whole point: it turns
// "I cannot reach this region" into "nobody can", which is the question the page
// is named after.
//
// It is an unauthenticated write, so treat the numbers as crowd-sourced rather
// than authoritative. What keeps it honest is cheapness of poisoning versus
// value: the payload is bounded and deduped to one vote per region, the route
// is IP rate limited, and the only thing a determined liar can move is a status
// page's history chart. Nothing here feeds the page's outage verdict, which
// still comes from server-recorded user traffic.

const MAX_REGIONS = 32;
// TorBox's region codes are short lowercase words (ceur, enam, japn). Matching
// the shape rather than an allowlist means a region TorBox adds tomorrow is
// recorded instead of silently dropped.
const REGION_PATTERN = /^[a-z0-9]{2,12}$/;
// Node probes time out at 8s, so anything past that did not come from the panel.
const MAX_LATENCY_MS = 60_000;

interface SubmitBody {
	results?: unknown;
}

export function parseSamples(body: unknown): TorBoxCdnSample[] {
	const results = (body as SubmitBody | null)?.results;
	if (!Array.isArray(results)) return [];

	// One vote per region per submission: a reader whose payload repeats a
	// region must not outweigh one whose payload does not.
	const byRegion = new Map<string, TorBoxCdnSample>();

	for (const entry of results.slice(0, MAX_REGIONS)) {
		if (!entry || typeof entry !== 'object') continue;
		const candidate = entry as { region?: unknown; ok?: unknown; latencyMs?: unknown };

		if (typeof candidate.region !== 'string') continue;
		const region = candidate.region.toLowerCase();
		if (!REGION_PATTERN.test(region)) continue;
		if (typeof candidate.ok !== 'boolean') continue;
		if (byRegion.has(region)) continue;

		const rawLatency = candidate.latencyMs;
		const latencyMs =
			typeof rawLatency === 'number' &&
			Number.isFinite(rawLatency) &&
			rawLatency >= 0 &&
			rawLatency <= MAX_LATENCY_MS
				? rawLatency
				: null;

		byRegion.set(region, { region, ok: candidate.ok, latencyMs });
	}

	return Array.from(byRegion.values());
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const samples = parseSamples(req.body);
	if (samples.length === 0) {
		return res.status(400).json({ error: 'No usable results' });
	}

	try {
		const recorded = await repository.recordTorBoxCdnSamples(samples);
		return res.status(202).json({ recorded });
	} catch (error) {
		console.error('Failed to record TorBox CDN samples:', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.report);
