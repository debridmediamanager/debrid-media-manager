import { flattenAndRemoveDuplicates, sortByFileSize } from '@/services/mediasearch';
import { PlanetScaleCache } from '@/services/planetscale';
import { NextApiHandler } from 'next';

const db = new PlanetScaleCache();

// returns scraped results or marks the imdb id as requested
const handler: NextApiHandler = async (req, res) => {
	const { imdbId, seasonNum } = req.query;

	if (!imdbId || !(typeof imdbId === 'string')) {
		res.status(400).json({ errorMessage: 'Missing "imdbId" query parameter' });
		return;
	}
	if (!seasonNum || !(typeof seasonNum === 'string')) {
		res.status(400).json({
			errorMessage: 'Missing "seasonNum" query parameter',
		});
		return;
	}

	try {
		const results = await Promise.all([
			db.getScrapedResults<any[]>(
				`tv:${imdbId.toString().trim()}:${parseInt(seasonNum.toString().trim(), 10)}`
			),
			db.getScrapedTrueResults<any[]>(
				`tv:${imdbId.toString().trim()}:${parseInt(seasonNum.toString().trim(), 10)}`
			),
		]);
		// should contain both results
		const searchResults = [...(results[0] || []), ...(results[1] || [])];
		if (searchResults) {
			let processedResults = flattenAndRemoveDuplicates(searchResults);
			processedResults = sortByFileSize(processedResults);
			res.status(200).json({ results: searchResults });
			return;
		}

		const isProcessing = await db.keyExists(`processing:${imdbId.toString().trim()}`);
		if (isProcessing) {
			res.setHeader('status', 'processing').status(204).json(null);
			return;
		}

		await db.saveScrapedResults(`requested:${imdbId.toString().trim()}`, []);
		res.setHeader('status', 'requested').status(204).json(null);
	} catch (error: any) {
		console.error('encountered a db issue', error);
		res.status(500).json({ errorMessage: error.message });
	}
};

export default handler;
