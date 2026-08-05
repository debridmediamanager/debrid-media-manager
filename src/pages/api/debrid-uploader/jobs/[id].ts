import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import type { NextApiRequest, NextApiResponse } from 'next';

const DEBRID_UPLOADER_URL = process.env.DEBRID_UPLOADER_URL || 'http://138.201.246.20:3100';

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET' && req.method !== 'DELETE') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { id } = req.query;
	if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(id)) {
		return res.status(400).json({ error: 'Invalid job id' });
	}

	try {
		const response = await fetch(`${DEBRID_UPLOADER_URL}/jobs/${id}`, {
			method: req.method,
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(15000),
		});
		const data = await response.json();
		return res.status(response.status).json(data);
	} catch (error) {
		console.error('Debrid uploader job poll failed:', error);
		return res.status(502).json({ error: 'Debrid uploader service unreachable' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
