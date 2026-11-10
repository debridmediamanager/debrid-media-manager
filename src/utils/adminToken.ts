import { timingSafeEqual } from 'crypto';
import type { NextApiRequest } from 'next';

/** `Authorization: Bearer <expected>`, compared in constant time. False when no token is configured. */
export const hasAdminToken = (req: NextApiRequest, expected: string | undefined): boolean => {
	const header = req.headers.authorization;
	if (!expected || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
	const given = Buffer.from(header.slice('Bearer '.length));
	const want = Buffer.from(expected);
	return given.length === want.length && timingSafeEqual(given, want);
};
