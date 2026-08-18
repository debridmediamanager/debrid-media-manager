import { getCanaryStore } from '@/services/canary/canaryStore';
import { getClientIp } from '@/services/rateLimit/middlewareRateLimiter';
import type { NextApiRequest, NextApiResponse } from 'next';
import { classifyCanary, type CanaryKind } from './canary';

/**
 * Trips on a request for an impossible title. Returns the canary kind when the
 * id could not have come from a browser session, or null for ordinary traffic.
 *
 * Recording is best-effort - a tripwire that can fail a request is worse than
 * no tripwire - so a store failure still returns the classification.
 */
export async function checkCanary(req: NextApiRequest, imdbId: string): Promise<CanaryKind | null> {
	const kind = classifyCanary(imdbId);
	if (!kind) return null;

	const path = req.url?.split('?')[0] || '';
	const identity = getClientIp(
		(req.headers['cf-connecting-ip'] as string) || null,
		(req.headers['x-real-ip'] as string) || null,
		(req.headers['x-forwarded-for'] as string) || null
	);

	try {
		await getCanaryStore().record(identity, { imdbId: imdbId.trim(), kind, path });
	} catch {
		// Never let the tripwire break the request it is watching.
	}
	console.warn(`[canary] ${kind} hit identity=${identity} imdbId=${imdbId.trim()} path=${path}`);
	return kind;
}

/**
 * Answers exactly as a genuine never-scraped title does, so a caller cannot
 * tell a canary apart from an id DMM simply has no results for.
 */
export function respondAsNeverScraped(res: NextApiResponse): void {
	res.setHeader('status', 'requested');
	res.status(204).end();
}
