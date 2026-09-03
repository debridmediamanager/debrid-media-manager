import { resolveDebridLinkUser } from '@/utils/debridLinkCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

// POST, not GET: the credential travels in the body so it never reaches an
// access log or a proxy cache key. Debrid-Link accepts `?access_token=<token>`
// upstream as well as the header, which is exactly the shape that put ten
// Real-Debrid keys into nginx's logs - a token in a URL is a token on disk.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('Cache-Control', 'no-store, private');

	if (req.method !== 'POST') {
		res.setHeader('Allow', ['POST']);
		res.status(405).end(`Method ${req.method} Not Allowed`);
		return;
	}

	const { apiKey } = req.body ?? {};
	if (!apiKey || typeof apiKey !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid "apiKey" in request body',
		});
		return;
	}

	try {
		const { valid, userId } = await resolveDebridLinkUser(apiKey);
		if (!valid || !userId) {
			res.status(401).json({ status: 'error', errorMessage: 'Invalid Debrid-Link token' });
			return;
		}

		res.status(200).json({ id: userId });
	} catch (error) {
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
