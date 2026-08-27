import { repository as db } from '@/services/repository';
import { buildCatalogMetas } from '@/utils/castCatalogMeta';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (req.method === 'OPTIONS') {
		return res.status(200).end();
	}

	const { userid } = req.query;

	if (typeof userid !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid" query parameter',
		});
		return;
	}

	try {
		const movies = await db.fetchAllDebridCastedMovies(userid);

		const metas = await buildCatalogMetas(movies, 'movie');

		res.status(200).json({
			metas,
			cacheMaxAge: 0,
		});
	} catch (error) {
		console.error(
			'Failed to get AllDebrid casted movies:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to get AllDebrid casted movies' });
	}
}
