import { PlanetScaleCache } from '@/services/planetscale';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { method, query } = req;
	const token = query.token as string;

	if (!token) {
		return res.status(401).json({ error: 'No token provided' });
	}

	const planetscale = new PlanetScaleCache();

	switch (method) {
		case 'GET':
			try {
				const links = await planetscale.fetchAllCastedLinks(token);
				res.status(200).json(links);
			} catch (error) {
				console.error('Error fetching links:', error);
				res.status(500).json({ error: 'Failed to fetch links' });
			}
			break;

		case 'DELETE':
			try {
				const { imdbId, hash } = req.query;
				if (!imdbId || !hash) {
					return res.status(400).json({ error: 'Missing required parameters' });
				}
				await planetscale.deleteCastedLink(imdbId as string, token, hash as string);
				res.status(200).json({ message: 'Link deleted successfully' });
			} catch (error) {
				console.error('Error deleting link:', error);
				res.status(500).json({ error: 'Failed to delete link' });
			}
			break;

		default:
			res.setHeader('Allow', ['GET', 'DELETE']);
			res.status(405).end(`Method ${method} Not Allowed`);
	}
}
