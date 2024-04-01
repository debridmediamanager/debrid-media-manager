import { PlanetScaleCache } from '@/services/planetscale';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { userid, imdbid, pingpong } = req.query;
	if (!userid || !imdbid || !pingpong) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "userid", "imdbid" or "pingpong" query parameter',
		});
		return;
	}
	if (typeof userid !== 'string' || typeof imdbid !== 'string' || typeof pingpong !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid", "imdbid" or "pingpong" query parameter',
		});
		return;
	}
	res.setHeader('access-control-allow-origin', '*');
	// get the last casted stream url
	const streamUrl = await db.getLatestCast(imdbid, userid);
	// if present, redirect to row url
	if (streamUrl) {
		res.redirect(302, streamUrl);
		return;
	}
	// if not then redirect to ping pong
	await new Promise((resolve) => setTimeout(resolve, 3000));
	res.redirect(
		302,
		`${process.env.DMM_ORIGIN}/api/stremio/${userid}/watch/${imdbid}/${
			pingpong === 'ping' ? 'pong' : 'ping'
		}`
	);
}
