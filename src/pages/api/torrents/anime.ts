import { flattenAndRemoveDuplicates, sortByFileSize } from '@/services/mediasearch';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { validateProblemToken } from '@/utils/problemToken';
import { NextApiHandler } from 'next';

// returns scraped results or marks the imdb id as requested
const handler: NextApiHandler = async (req, res) => {
	const { animeId, dmmProblemKey, solution, onlyTrusted } = req.query;

	if (
		!dmmProblemKey ||
		!(typeof dmmProblemKey === 'string') ||
		!solution ||
		!(typeof solution === 'string')
	) {
		res.status(403).json({ errorMessage: 'Authentication not provided' });
		return;
	} else if (!validateProblemToken(dmmProblemKey, solution)) {
		res.status(403).json({ errorMessage: 'Authentication error' });
		return;
	}

	if (!animeId || !(typeof animeId === 'string')) {
		res.status(400).json({ errorMessage: 'Missing "imdbId" query parameter' });
		return;
	}

	try {
		const promises = [db.getScrapedTrueResults<any[]>(`anime:${animeId.toString().trim()}`)];
		// if (onlyTrusted !== 'true') {
		// 	promises.push(db.getScrapedResults<any[]>(`anime:${animeId.toString().trim()}`));
		// }
		const results = await Promise.all(promises);
		// should contain both results
		const searchResults = [...(results[0] || []), ...(results[1] || [])];

		if (searchResults.length === 0) {
			const isProcessing = await db.keyExists(`processing:${animeId.toString().trim()}`);
			if (isProcessing) {
				res.setHeader('status', 'processing').status(204).end();
				return;
			}

			await db.saveScrapedResults(`requested:${animeId.toString().trim()}`, []);
			res.setHeader('status', 'requested').status(204).end();
			return;
		}

		let processedResults = flattenAndRemoveDuplicates(
			searchResults.map((r) => {
				r.title = r.filename;
				r.fileSize = r.size_bytes;
				return r;
			})
		);
		processedResults = sortByFileSize(processedResults);
		res.status(200).json({ results: processedResults });
	} catch (error: any) {
		console.error(
			'Encountered a database issue:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ errorMessage: 'An internal error occurred' });
	}
};

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.torrents);
