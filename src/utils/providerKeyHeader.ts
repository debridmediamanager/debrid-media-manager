import { NextApiRequest, NextApiResponse } from 'next';

/** The key from `Authorization: Bearer <key>`, or null. Nothing else is read. */
export const readBearerKey = (req: NextApiRequest): string | null => {
	const authHeader = req.headers.authorization;
	if (typeof authHeader !== 'string') return null;
	const bearer = authHeader.match(/^Bearer\s+(.+)$/i);
	const token = bearer?.[1].trim();
	return token || null;
};

/**
 * Answers 400 and returns true when the query string names a key parameter.
 *
 * For routes that only dmm's own pages ever called with the key in the URL.
 * Honouring such a request would keep a leaking client working silently, and
 * the key is already in the access log by the time the handler runs, so the
 * request is refused - present but empty counts too - and the response never
 * echoes what was sent.
 */
export const refuseQueryKey = (
	req: NextApiRequest,
	res: NextApiResponse,
	queryNames: string[]
): boolean => {
	if (!queryNames.some((name) => req.query[name] !== undefined)) return false;
	res.status(400).json({
		status: 'error',
		errorMessage:
			'Send the key in the Authorization header, never in the URL. Reload Debrid Media Manager and try again.',
	});
	return true;
};

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
	const fromHeader = readBearerKey(req);
	if (fromHeader) return fromHeader;

	for (const name of queryNames) {
		const value = req.query[name];
		if (typeof value === 'string' && value) return value;
	}

	const bodyKey = req.body?.apiKey ?? req.body?.token;
	if (typeof bodyKey === 'string' && bodyKey) return bodyKey;

	return null;
};
