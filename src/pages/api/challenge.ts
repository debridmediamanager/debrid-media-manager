import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { turnstileSiteKey, verifyTurnstile } from '@/services/turnstile';
import { validateOwnPageRequest } from '@/utils/ownPageRequest';
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
	// Only DMM's pages get a token. Open to anyone, it let scripts mint one and
	// then search torrents (2026-11-11: Cenluma-Media-Intake, 22,777 searches in 2.5 days).
	if (!validateOwnPageRequest(req, res)) return;

	// The page proves it is a browser first (services/turnstile). 401 hands it the
	// site key to run the widget with; a failed answer is 403 and the page asks again.
	const siteKey = turnstileSiteKey();
	if (siteKey) {
		res.setHeader('Cache-Control', 'no-store, private');
		const verdict = await verifyTurnstile(req);
		if (verdict === 'unreachable') {
			// Cloudflare down is no reason to take every title page down with it.
			console.error('Turnstile siteverify unreachable; minting without it');
		} else if (verdict === 'fail') {
			const status = req.headers['x-turnstile-token'] ? 403 : 401;
			return res.status(status).json({ error: 'Browser check required', turnstile: siteKey });
		}
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
