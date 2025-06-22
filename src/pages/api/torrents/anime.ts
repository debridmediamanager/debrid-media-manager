import { flattenAndRemoveDuplicates, sortByFileSize } from '@/services/mediasearch';
import { Repository } from '@/services/repository';
import { validateTokenWithHash } from '@/utils/token';
import { NextApiHandler } from 'next';

const db = new Repository();

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
	} else if (!(await validateTokenWithHash(dmmProblemKey.toString(), solution.toString()))) {
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
		if (searchResults) {
			let processedResults = flattenAndRemoveDuplicates(
				searchResults.map((r) => {
					r.title = r.filename;
					r.fileSize = r.size_bytes;
					return r;
				})
			);
			processedResults = sortByFileSize(processedResults);
			res.status(200).json({ results: processedResults });
			return;
		}

		const isProcessing = await db.keyExists(`processing:${animeId}`);
		if (isProcessing) {
			res.setHeader('status', 'processing').status(204).json(null);
			return;
		}

		await db.saveScrapedResults(`requested:${animeId.toString().trim()}`, []);
		res.setHeader('status', 'requested').status(204).json(null);
	} catch (error: any) {
		console.error(
			'Encountered a database issue:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ errorMessage: 'An internal error occurred' });
	}
};

export default handler;
