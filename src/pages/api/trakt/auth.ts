import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	// redirect to trakt.tv to get a code
	const { redirect } = req.query;
	const loginUrl = `https://trakt.tv/oauth/authorize?response_type=code&client_id=${process.env.TRAKT_CLIENT_ID}&redirect_uri=${redirect}/trakt/callback`;
	res.redirect(loginUrl);
}
