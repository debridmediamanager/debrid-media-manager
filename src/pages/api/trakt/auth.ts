import { NextApiRequest, NextApiResponse } from 'next';

const ALLOWED_REDIRECT_ORIGINS = [
	'http://localhost:3000',
	'http://127.0.0.1:3000',
	'https://debridmediamanager.com',
	'https://www.debridmediamanager.com',
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { redirect } = req.query;

	if (!redirect || typeof redirect !== 'string') {
		return res.status(400).json({ error: 'Missing redirect parameter' });
	}

	// A self-hosted copy signs in at its own DMM_ORIGIN, which only the server sets.
	const allowed = [...ALLOWED_REDIRECT_ORIGINS, process.env.DMM_ORIGIN?.replace(/\/+$/, '')];
	if (!allowed.includes(redirect)) {
		return res.status(400).json({ error: 'Invalid redirect origin' });
	}

	const loginUrl = `https://trakt.tv/oauth/authorize?response_type=code&client_id=${process.env.TRAKT_CLIENT_ID}&redirect_uri=${encodeURIComponent(`${redirect}/trakt/callback`)}`;
	res.redirect(loginUrl);
}
