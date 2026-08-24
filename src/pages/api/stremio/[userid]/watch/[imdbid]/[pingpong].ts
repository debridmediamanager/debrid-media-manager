import { repository as db } from '@/services/repository';
import { NextApiRequest, NextApiResponse } from 'next';

// How many times the ping-pong long poll bounces before it gives up.
// It used to bounce forever: each hop held a request open for 3 s and then
// redirected to itself, so the only thing that stopped it was the browser's
// redirect cap - roughly 20 hops of held server time per click, every click.
const MAX_HOPS = 20;
const HOP_DELAY_MS = 3000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { userid, imdbid, pingpong, hop } = req.query;
	if (typeof userid !== 'string' || typeof imdbid !== 'string' || typeof pingpong !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid", "imdbid" or "pingpong" query parameter',
		});
		return;
	}

	// get the last casted stream url
	const latestCast = await db.getLatestCast(imdbid, userid);
	if (latestCast && latestCast.link) {
		// No token: the play route resolves the user's own stored credentials and
		// has never read one. Passing it only put an RD token in the address bar
		// and in every access log on the way.
		res.redirect(
			302,
			`${process.env.DMM_ORIGIN}/api/stremio/${userid}/play/${latestCast.link.substring(26)}`
		);
		return;
	}

	if (latestCast && latestCast.url) {
		res.redirect(302, latestCast.url);
		return;
	}

	const hopCount = typeof hop === 'string' ? parseInt(hop, 10) : 0;
	const nextHop = Number.isNaN(hopCount) ? 1 : hopCount + 1;
	if (nextHop > MAX_HOPS) {
		res.status(404).json({
			status: 'error',
			errorMessage: 'Nothing was cast for this title. Cast a file from DMM and try again.',
		});
		return;
	}

	// if not then redirect to ping pong
	await new Promise((resolve) => setTimeout(resolve, HOP_DELAY_MS));
	res.redirect(
		302,
		`${process.env.DMM_ORIGIN}/api/stremio/${userid}/watch/${imdbid}/${
			pingpong === 'ping' ? 'pong' : 'ping'
		}?hop=${nextHop}`
	);
}
