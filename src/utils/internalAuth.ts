import { timingSafeEqual } from 'crypto';
import type { NextApiRequest } from 'next';

/**
 * Whether a request carries the shared secret for DMM's internal APIs, sent as
 * `Authorization: Bearer <secret>`. An unset secret refuses everyone: these
 * endpoints spend provider quota every DMM user shares, and an open default
 * would hand scrapers a merged metadata API.
 */
export function hasInternalSecret(req: NextApiRequest, secret: string | undefined): boolean {
	if (!secret) return false;
	const header = req.headers.authorization;
	const given = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
	const a = Buffer.from(given);
	const b = Buffer.from(secret);
	return a.length === b.length && timingSafeEqual(a, b);
}
