import { timingSafeEqual } from 'crypto';
import type { NextApiRequest } from 'next';

/**
 * `Authorization: Bearer <ADMIN_TOKEN>`, compared in constant time: the one token every
 * /admin page and admin API takes. False when no token is configured.
 */
export const isAdmin = (req: NextApiRequest): boolean => {
	const expected = process.env.ADMIN_TOKEN;
	const header = req.headers.authorization;
	if (!expected || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
	const given = Buffer.from(header.slice('Bearer '.length));
	const want = Buffer.from(expected);
	return given.length === want.length && timingSafeEqual(given, want);
};
