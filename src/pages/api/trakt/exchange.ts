import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Trades a sign-in code (GET `?code=`) or a refresh token (POST `{refresh_token}`) for
 * Trakt tokens, adding DMM's client secret here so it never reaches the browser.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	// A refresh token is a lasting credential, so it comes in a POST body, never in a logged URL.
	const refreshToken =
		req.method === 'POST' && typeof req.body?.refresh_token === 'string'
			? req.body.refresh_token
			: '';
	const { code, redirect } = refreshToken ? req.body : req.query;
	if (!refreshToken && (!code || typeof code !== 'string')) {
		res.status(400).json({ errorMessage: "Missing 'code' query parameter" });
		return;
	}

	const requestBody = {
		...(refreshToken ? { refresh_token: refreshToken } : { code }),
		client_id: process.env.TRAKT_CLIENT_ID,
		client_secret: process.env.TRAKT_CLIENT_SECRET,
		redirect_uri: redirect ?? '',
		grant_type: refreshToken ? 'refresh_token' : 'authorization_code',
	};

	try {
		const response = await fetch('https://api.trakt.tv/oauth/token', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'user-agent': 'debridmediamanager/1.0',
			},
			body: JSON.stringify(requestBody),
		});

		const text = await response.text();
		try {
			const data = JSON.parse(text);
			res.status(response.ok ? 200 : response.status).json(data);
		} catch {
			console.error(
				'Trakt token exchange returned non-JSON:',
				response.status,
				text.slice(0, 500)
			);
			res.status(502).json({
				error: 'token_exchange_failed',
				error_description: 'Trakt returned non-JSON response',
			});
		}
	} catch (error) {
		console.error('Trakt token exchange fetch failed:', error);
		res.status(500).json({ error: 'token_exchange_failed', error_description: String(error) });
	}
}
