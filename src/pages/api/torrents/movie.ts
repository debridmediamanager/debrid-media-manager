import { flattenAndRemoveDuplicates, sortByFileSize } from '@/services/mediasearch';
import { Repository } from '@/services/repository';
import { validateTokenWithHash } from '@/utils/token';
import { NextApiHandler } from 'next';

const db = new Repository();

// returns scraped results or marks the imdb id as requested
const handler: NextApiHandler = async (req, res) => {
	const { imdbId, dmmProblemKey, solution, onlyTrusted, maxSize, page } = req.query;

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

	if (!imdbId || !(typeof imdbId === 'string')) {
		res.status(400).json({ errorMessage: 'Missing "imdbId" query parameter' });
		return;
	}

	try {
		const maxSizeInGB = maxSize ? parseInt(maxSize.toString()) : 0;
		const pageNum = page ? parseInt(page.toString()) : 0;
		const promises = [
			db.getScrapedTrueResults<any[]>(
				`movie:${imdbId.toString().trim()}`,
				maxSizeInGB,
				pageNum
			),
		];
		if (onlyTrusted !== 'true') {
			promises.push(
				db.getScrapedResults<any[]>(
					`movie:${imdbId.toString().trim()}`,
					maxSizeInGB,
					pageNum
				)
			);
		}
		const results = await Promise.all(promises);
		// should contain both results
		const searchResults = [...(results[0] || []), ...(results[1] || [])];
		if (searchResults) {
			try {
				// Get reported hashes to filter out
				const reportedHashes = await db.getReportedHashes(imdbId.toString().trim());

				// Filter out reported torrents before any processing
				const filteredResults = searchResults.filter((torrent) => {
					if (!torrent.hash) return true; // Keep torrents without hash (shouldn't happen, but safe fallback)
					const isReported = reportedHashes.includes(torrent.hash);
					return !isReported;
				});

				// Process the filtered results
				let processedResults = flattenAndRemoveDuplicates(filteredResults);
				processedResults = sortByFileSize(processedResults);
				res.status(200).json({ results: processedResults });
				return;
			} catch (error: any) {
				console.error(
					'Error filtering reported hashes:',
					error instanceof Error ? error.message : 'Unknown error'
				);
				// If filtering fails, continue with unfiltered results
				let processedResults = flattenAndRemoveDuplicates(searchResults);
				processedResults = sortByFileSize(processedResults);
				res.status(200).json({ results: processedResults });
				return;
			}
		}

		const isProcessing = await db.keyExists(`processing:${imdbId}`);
		if (isProcessing) {
			res.setHeader('status', 'processing').status(204).json(null);
			return;
		}

		await db.saveScrapedResults(`requested:${imdbId.toString().trim()}`, []);
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
