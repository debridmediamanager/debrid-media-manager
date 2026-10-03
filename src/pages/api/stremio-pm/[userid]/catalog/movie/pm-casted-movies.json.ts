import { repository as db } from '@/services/repository';
import { sendCatalogError } from '@/utils/castAddonResponses';
import { buildCatalogMetas } from '@/utils/castCatalogMeta';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (req.method === 'OPTIONS') {
		return res.status(200).end();
	}

	const { userid } = req.query;
	if (typeof userid !== 'string') {
		res.status(400).json({ status: 'error', errorMessage: 'Invalid "userid" query parameter' });
		return;
	}

	try {
		const movies = await db.fetchPremiumizeCastedMovies(userid);
		res.status(200).json({
			metas: await buildCatalogMetas(movies, 'movie'),
			cacheMaxAge: 0,
		});
	} catch (error) {
		sendCatalogError(res, 'pm', error, { firstPage: true });
	}
}
