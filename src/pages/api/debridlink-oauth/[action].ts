import { handleDebridLinkOAuthRequest } from '@/services/debridLinkOAuthProxy';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Debrid-Link device-code login. The browser could reach these endpoints itself
 * - Debrid-Link's CORS is wide open - but the `client_id` and the scope list are
 * server-owned, so the request is composed here instead. Request handling lives
 * in `services/debridLinkOAuthProxy` so it can be tested.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('Cache-Control', 'no-store, private');

	const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
	const { httpStatus, body, allowHeader } = await handleDebridLinkOAuthRequest({
		method: req.method,
		action: typeof action === 'string' ? action : '',
		body: req.body,
	});

	if (allowHeader) res.setHeader('Allow', allowHeader);
	res.status(httpStatus).json(body);
}
