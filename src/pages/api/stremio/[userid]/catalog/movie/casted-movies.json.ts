import { Repository } from '@/services/repository';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new Repository();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { userid } = req.query;
	if (typeof userid !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid" query parameter',
		});
		return;
	}

	if (req.method === 'OPTIONS') {
		res.setHeader('access-control-allow-origin', '*');
		return res.status(200).end();
	}

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
		cacheMaxAge: 0,
	});
}
