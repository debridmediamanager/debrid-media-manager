import { Repository } from '@/services/planetscale';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new Repository();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { userid } = req.query;
	const castedShows = await db.fetchCastedShows(userid as string);
	const shows = [];
	for (const show of castedShows) {
		shows.push({
			id: show,
			type: 'series',
			poster: `https://images.metahub.space/poster/small/${show}/img`,
		});
	}
	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json({
		metas: shows,
	});
}
