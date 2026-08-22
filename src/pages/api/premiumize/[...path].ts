import { handlePremiumizeProxyRequest, joinEndpoint } from '@/services/premiumizeProxy';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Server-side proxy for the Premiumize API.
 *
 * Premiumize cannot be called from the browser the way the other three services
 * are: its CORS preflight approves no request headers, so a cross-origin
 * `Authorization: Bearer` never gets through and the only browser-usable
 * transports put the API key in the URL - which is exactly how ten Real-Debrid
 * keys ended up in the nginx access logs. Proxying same-origin keeps the key in
 * a header. The request handling itself lives in `services/premiumizeProxy` so
 * it can be tested; anything under `pages/` is a route, test files included.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('Cache-Control', 'no-store, private');

	const { httpStatus, body, allowHeader } = await handlePremiumizeProxyRequest({
		method: req.method,
		endpoint: joinEndpoint(req.query.path),
		authorization: req.headers.authorization,
		body: req.body,
	});

	if (allowHeader) res.setHeader('Allow', allowHeader);
	res.status(httpStatus).json(body);
}
