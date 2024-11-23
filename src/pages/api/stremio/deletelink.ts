import { PlanetScaleCache } from '@/services/planetscale';
import { handleApiError, validateMethod, validateToken } from '@/utils/castApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (!validateMethod(req, res, ['POST'])) return;

	const token = validateToken(req, res);
	if (!token) return;

	const { imdbId, hash } = req.body;

	if (!imdbId || !hash) {
		res.status(400).json({ error: 'Missing required parameters' });
		return;
	}

	try {
		const planetscale = new PlanetScaleCache();
		await planetscale.deleteCastedLink(imdbId, token, hash);
		res.status(200).json({ message: 'Link deleted successfully' });
	} catch (error) {
		handleApiError(error, res, 'Failed to delete link');
	}
}
