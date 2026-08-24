import { NextApiRequest } from 'next';

/**
 * Reads a debrid key off the Authorization header, falling back to the query
 * string.
 *
 * The cast routes used to take the key as a query parameter, which writes it
 * verbatim into nginx and Cloudflare access logs on every request - and an RD
 * `apitoken` key never expires. AllDebrid's helper was moved off the query
 * string for exactly this reason; this brings the rest along.
 *
 * The query fallback stays so a page loaded before the deploy keeps working.
 * dmm's own clients send the header.
 */
export const readProviderKey = (req: NextApiRequest, queryNames: string[]): string | null => {
	const authHeader = req.headers.authorization;
	if (typeof authHeader === 'string') {
		const bearer = authHeader.match(/^Bearer\s+(.+)$/i);
		if (bearer) {
			const token = bearer[1].trim();
			if (token) return token;
		}
	}

	for (const name of queryNames) {
		const value = req.query[name];
		if (typeof value === 'string' && value) return value;
	}

	const bodyKey = req.body?.apiKey ?? req.body?.token;
	if (typeof bodyKey === 'string' && bodyKey) return bodyKey;

	return null;
};
