import { handleSimklRequest } from '@/services/simklProxy';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const route = Array.isArray(req.query.route) ? req.query.route : [];
	const result = await handleSimklRequest({
		method: req.method,
		route,
		body: req.body,
		headers: req.headers,
	});
	for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
	res.status(result.httpStatus).json(result.body);
}
