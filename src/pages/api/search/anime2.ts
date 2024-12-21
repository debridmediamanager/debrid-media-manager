import { Repository } from '@/services/repository';
import { NextApiHandler } from 'next';

const db = new Repository();

const handler: NextApiHandler = async (req, res) => {
	const { keyword } = req.query;

	if (!keyword || !(typeof keyword === 'string')) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "keyword" query parameter',
		});
		return;
	}

	try {
		const results: AnimeSearchResult[] = await db.searchAnimeByTitle(keyword);
		res.status(200).json({ results });
	} catch (error) {
		console.error('An error occurred while fetching the data:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: 'An error occurred while fetching the data',
		});
	}
};

export default handler;
