import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { code, redirect } = req.query;
	if (!code || typeof code !== 'string') {
		res.status(400).json({ errorMessage: "Missing 'code' query parameter" });
		return;
	}

	const requestBody = {
		code,
		client_id: process.env.TRAKT_CLIENT_ID,
		client_secret: process.env.TRAKT_CLIENT_SECRET,
		redirect_uri: redirect ?? '',
		grant_type: 'authorization_code',
	};

	const response = await fetch('https://api.trakt.tv/oauth/token', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
		},
		body: JSON.stringify(requestBody),
	});

	const data = await response.json();
	res.status(response.ok ? 200 : response.status).json(data);
}
