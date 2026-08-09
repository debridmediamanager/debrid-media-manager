import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import type { NextApiRequest, NextApiResponse } from 'next';

// Ask Real-Debrid whether a token is real, from the server.
//
// The browser cannot do this itself: DMM's CORS proxy answers with a fixed
// `Access-Control-Allow-Origin: https://debridmediamanager.com`, so the same
// call from a self-hosted or local DMM fails as a network error. A caller that
// could not tell that apart from a 401 would tell people with a perfectly good
// token that Real-Debrid had rejected it — hence the three distinct outcomes
// below, and hence doing it here instead.
//
// POST, not GET: the token is a credential and a query string ends up in every
// access log between here and the client.

const RD_USER_URL = 'https://app.real-debrid.com/rest/1.0/user';

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const token = req.body?.token;
	if (typeof token !== 'string' || !token.trim()) {
		return res.status(400).json({ error: 'token is required' });
	}

	let response: Response;
	try {
		response = await fetch(RD_USER_URL, {
			headers: { Authorization: `Bearer ${token.trim()}` },
			signal: AbortSignal.timeout(15000),
		});
	} catch {
		// Distinct from a rejection: we never got an answer, so we know nothing
		// about the token and must not imply that we do.
		return res.status(502).json({ error: 'Real-Debrid could not be reached' });
	}

	if (response.status === 401 || response.status === 403) {
		return res.status(200).json({ valid: false });
	}
	if (!response.ok) {
		return res.status(502).json({ error: `Real-Debrid answered ${response.status}` });
	}

	const user = await response.json().catch(() => null);
	if (!user || typeof user.username !== 'string') {
		return res.status(502).json({ error: 'Real-Debrid returned an unexpected reply' });
	}

	// Only what the caller needs to confirm the account — never echo the token.
	return res.status(200).json({
		valid: true,
		username: user.username,
		premium: Number(user.premium) > 0,
	});
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
