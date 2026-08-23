import { handlePremiumizeOAuthRequest } from '@/services/premiumizeOAuthProxy';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Premiumize device-code login. Separate from `/api/premiumize/*` because that
 * proxy requires the user's credential in an `Authorization` header - and during
 * a login there is not one yet. Request handling lives in
 * `services/premiumizeOAuthProxy` so it can be tested.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('Cache-Control', 'no-store, private');

	const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
	const { httpStatus, body, allowHeader } = await handlePremiumizeOAuthRequest({
		method: req.method,
		action: typeof action === 'string' ? action : '',
		body: req.body,
	});

	if (allowHeader) res.setHeader('Allow', allowHeader);
	res.status(httpStatus).json(body);
}
