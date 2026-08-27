import { repository as db } from '@/services/repository';
import { isLegacyToken } from '@/utils/castApiHelpers';
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

	// Check for legacy 5-character token
	if (isLegacyToken(userid)) {
		res.status(200).json({
			metas: [
				{
					id: 'dmm-update-required',
					type: 'movie',
					name: '⚠️ DMM Cast RD Update Required',
					description:
						'Please reinstall the addon from https://debridmediamanager.com/stremio',
					poster: 'https://static.debridmediamanager.com/dmmcast.png',
				},
			],
			cacheMaxAge: 0,
		});
		return;
	}

	try {
		const castedMovies = await db.fetchCastedMovies(userid);
		const metas = await buildCatalogMetas(castedMovies, 'movie');

		res.status(200).json({
			metas,
			cacheMaxAge: 0,
		});
	} catch (error) {
		console.error(
			'Failed to get RD casted movies:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to get RD casted movies' });
	}
}
