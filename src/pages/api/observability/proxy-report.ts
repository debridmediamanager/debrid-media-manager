import { timingSafeEqual } from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

import { recordProxiedOperation } from '@/lib/observability/recordProxiedOperation';

/**
 * Ingest for outcomes observed by the Cloudflare Worker proxy.
 *
 * TorBox browser traffic cannot run through our own anticors: `*.cors` is a
 * single host, so it pools every user into one per-IP rate-limit bucket and
 * TorBox 429'd ~20% of it. The Worker egresses from Cloudflare's pool instead,
 * and reports here so `/is-torbox-down-or-just-me` still counts what real
 * users' calls returned.
 *
 * Unlike `cron.ts` and `aggregate.ts`, this fails CLOSED when the secret is
 * unset. Those two are unauthenticated in production today because their env
 * var was never set, and an open endpoint here would let anyone write the
 * numbers behind a public status page.
 */

const MAX_EVENTS = 200;

interface ProxyEvent {
	host: string;
	method: string;
	path: string;
	status: number;
}

function secretMatches(provided: unknown, expected: string): boolean {
	if (typeof provided !== 'string') return false;
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	// timingSafeEqual throws on a length mismatch, which is itself the answer
	return a.length === b.length && timingSafeEqual(a, b);
}

function isValidEvent(value: unknown): value is ProxyEvent {
	if (!value || typeof value !== 'object') return false;
	const event = value as Record<string, unknown>;
	return (
		typeof event.host === 'string' &&
		typeof event.method === 'string' &&
		typeof event.path === 'string' &&
		// A query string here would mean a `requestdl` token rode along
		!event.path.includes('?') &&
		typeof event.status === 'number' &&
		Number.isInteger(event.status) &&
		event.status >= 0 &&
		event.status <= 599
	);
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const expectedSecret = process.env.ANTICORS_REPORT_SECRET;
	if (!expectedSecret) {
		console.error('ANTICORS_REPORT_SECRET is not set; refusing proxy reports');
		return res.status(503).json({ error: 'Reporting is not configured' });
	}

	if (!secretMatches(req.headers['x-anticors-secret'], expectedSecret)) {
		return res.status(401).json({ error: 'Unauthorized' });
	}

	const body = req.body as { events?: unknown } | undefined;
	const events = body?.events;
	if (!Array.isArray(events)) {
		return res.status(400).json({ error: 'Expected an `events` array' });
	}
	if (events.length > MAX_EVENTS) {
		return res.status(413).json({ error: `At most ${MAX_EVENTS} events per request` });
	}

	// Recording is fire-and-forget by design, so a malformed entry is dropped
	// rather than failing the batch - the Worker cannot retry a report anyway.
	let accepted = 0;
	for (const event of events) {
		if (!isValidEvent(event)) continue;
		recordProxiedOperation(event.host, event.method, event.path, event.status);
		accepted += 1;
	}

	return res.status(200).json({ accepted, received: events.length });
}
