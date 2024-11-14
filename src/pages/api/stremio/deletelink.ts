import { PlanetScaleCache } from '@/services/planetscale';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', ['POST']);
		return res.status(405).end(`Method ${req.method} Not Allowed`);
	}

	const { token, imdbId, hash } = req.body;

	if (!token || !imdbId || !hash) {
		return res.status(400).json({ error: 'Missing required parameters' });
	}

	try {
		const planetscale = new PlanetScaleCache();
		await planetscale.deleteCastedLink(imdbId, token, hash);
		res.status(200).json({ message: 'Link deleted successfully' });
	} catch (error) {
		console.error('Error deleting link:', error);
		res.status(500).json({ error: 'Failed to delete link' });
	}
}
