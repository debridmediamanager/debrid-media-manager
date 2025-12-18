import { Repository } from '@/services/repository';
import { extractToken } from '@/utils/castApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new Repository();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { userid, imdbid, pingpong } = req.query;
	const token = extractToken(req);

	if (!token || typeof userid !== 'string' || typeof token !== 'string' || typeof imdbid !== 'string' || typeof pingpong !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid or missing "userid", "imdbid", "pingpong" or "token" parameter',
		});
		return;
	}
	res.setHeader('access-control-allow-origin', '*');
	// get the last casted stream url
	const latestCast = await db.getLatestCast(imdbid, userid);
	if (latestCast && latestCast.link) {
		res.redirect(
			302,
			`${process.env.DMM_ORIGIN}/api/stremio/${userid}/play/${latestCast.link.substring(26)}?token=${token}`
		);
		return;
	}

	if (latestCast && latestCast.url) {
		res.redirect(302, latestCast.url);
		return;
	}

	// if not then redirect to ping pong
	await new Promise((resolve) => setTimeout(resolve, 3000));
	res.redirect(
		302,
		`${process.env.DMM_ORIGIN}/api/stremio/${userid}/watch/${imdbid}/${
			pingpong === 'ping' ? 'pong' : 'ping'
		}?token=${token}`
	);
}
