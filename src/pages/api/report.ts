import { NextApiRequest, NextApiResponse } from 'next';
import { Repository } from '../../services/repository';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ message: 'Method not allowed' });
	}

	try {
		const { hash, imdbId, userId, type } = req.body;

		if (!hash || !imdbId || !userId || !type) {
			return res.status(400).json({ message: 'Missing required fields' });
		}

		// Validate report type
		if (!['porn', 'wrong_imdb', 'wrong_season'].includes(type)) {
			return res.status(400).json({ message: 'Invalid report type' });
		}

		const repository = new Repository();
		await repository.reportContent(
			hash,
			imdbId,
			userId,
			type as 'porn' | 'wrong_imdb' | 'wrong_season'
		);

		return res.status(200).json({ success: true });
	} catch (error) {
		console.error('Report error:', error);
		return res.status(500).json({ message: 'Internal server error' });
	}
}
