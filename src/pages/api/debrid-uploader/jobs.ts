import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import type { NextApiRequest, NextApiResponse } from 'next';

// The debrid uploader service on debrid02 speaks plain HTTP with no CORS, so the
// browser can never call it directly; this route is the server-side hop.
const DEBRID_UPLOADER_URL = process.env.DEBRID_UPLOADER_URL || 'http://138.201.246.20:3100';

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { hash, imdbId, rdKey, tbKey } = req.body ?? {};

	if (typeof hash !== 'string' || !/^[a-fA-F0-9]{40}$/.test(hash)) {
		return res.status(400).json({ error: 'hash must be a 40-char hex info hash' });
	}
	if (typeof imdbId !== 'string' || !/^tt\d+$/.test(imdbId)) {
		return res.status(400).json({ error: 'imdbId is required (format: tt1234567)' });
	}
	if (typeof rdKey !== 'string' || !rdKey) {
		return res.status(400).json({ error: 'rdKey is required' });
	}
	if (typeof tbKey !== 'string' || !tbKey) {
		return res.status(400).json({ error: 'tbKey is required' });
	}

	try {
		const response = await fetch(`${DEBRID_UPLOADER_URL}/jobs`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				input: `magnet:?xt=urn:btih:${hash.toLowerCase()}`,
				imdb_id: imdbId,
				rd_api_key: rdKey,
				tb_api_key: tbKey,
			}),
			signal: AbortSignal.timeout(30000),
		});
		const data = await response.json();
		return res.status(response.status).json(data);
	} catch (error) {
		console.error('Debrid uploader job creation failed:', error);
		return res.status(502).json({ error: 'Debrid uploader service unreachable' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
