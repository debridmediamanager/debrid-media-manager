import { PlanetScaleCache } from '@/services/planetscale';
import { handleApiError, validateMethod, validateToken } from '@/utils/castApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

async function getLinks(planetscale: PlanetScaleCache, token: string, res: NextApiResponse) {
	try {
		const links = await planetscale.fetchAllCastedLinks(token);
		res.status(200).json(links);
	} catch (error) {
		handleApiError(error, res, 'Failed to fetch links');
	}
}

async function deleteLink(
	planetscale: PlanetScaleCache,
	token: string,
	imdbId: string | string[] | undefined,
	hash: string | string[] | undefined,
	res: NextApiResponse
) {
	if (!imdbId || !hash || typeof imdbId !== 'string' || typeof hash !== 'string') {
		res.status(400).json({ error: 'Missing or invalid parameters' });
		return;
	}

	try {
		await planetscale.deleteCastedLink(imdbId, token, hash);
		res.status(200).json({ message: 'Link deleted successfully' });
	} catch (error) {
		handleApiError(error, res, 'Failed to delete link');
	}
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (!validateMethod(req, res, ['GET', 'DELETE'])) return;

	const token = validateToken(req, res);
	if (!token) return;

	const planetscale = new PlanetScaleCache();

	switch (req.method) {
		case 'GET':
			await getLinks(planetscale, token, res);
			break;
		case 'DELETE':
			await deleteLink(planetscale, token, req.query.imdbId, req.query.hash, res);
			break;
	}
}
