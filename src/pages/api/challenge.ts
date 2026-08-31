import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { getProblemSecret, mintProblemToken } from '@/utils/problemToken';
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

// Mints the token the availability and torrents endpoints ask for.
//
// The signing key used to be a constant inside `utils/token.ts`, which the movie,
// show and hashlist pages import — so it shipped to every browser and anyone
// could mint a token without asking. Signing here keeps the key server-side.
//
// Clients hold a minted token for most of its life (see `utils/token.ts`), so a
// tab hits this once every few minutes rather than once per row of a sweep.
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const secret = getProblemSecret();
	if (!secret) {
		console.error('DMM_PROBLEM_SECRET environment variable is not set');
		return res.status(500).json({ error: 'Server configuration error' });
	}

	const [token, hash] = mintProblemToken(secret);

	res.setHeader('Cache-Control', 'no-store, private');
	return res.status(200).json({ token, hash });
};

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
