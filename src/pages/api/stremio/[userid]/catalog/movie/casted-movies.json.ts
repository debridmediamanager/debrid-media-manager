import { PlanetScaleCache } from '@/services/planetscale';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { userid } = req.query;
	const castedMovies = await db.fetchCastedMovies(userid as string);
	const movies = [];
	for (const movie of castedMovies) {
		movies.push({
			id: movie,
			type: 'movie',
			poster: `https://images.metahub.space/poster/small/${movie}/img`,
		});
	}
	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json({
		metas: movies,
	});
}
