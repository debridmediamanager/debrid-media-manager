import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import type { NextApiRequest, NextApiResponse } from 'next';

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { hash } = req.body ?? {};
	if (typeof hash !== 'string' || !/^[a-fA-F0-9]{40}$/.test(hash)) {
		return res.status(400).json({ error: 'hash must be a 40-char hex string' });
	}

	try {
		await db.removeDebridTransfer(hash);
		return res.status(200).json({ removed: true });
	} catch (error) {
		console.error('Debrid transfer removal failed:', error);
		return res.status(500).json({ error: 'removal failed' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
