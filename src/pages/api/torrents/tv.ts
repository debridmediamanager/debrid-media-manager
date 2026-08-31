import { flattenAndRemoveDuplicates, sortByFileSize } from '@/services/mediasearch';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { checkCanary, respondAsNeverScraped } from '@/utils/canaryGuard';
import type { DebridioTarget } from '@/utils/debridioBackfill';
import {
	backfillFromDebridioNow,
	refreshDebridioAvailabilityInBackground,
} from '@/utils/debridioBackfill';
import { validateTokenWithHash } from '@/utils/token';
import { NextApiHandler } from 'next';

// returns scraped results or marks the imdb id as requested
const handler: NextApiHandler = async (req, res) => {
	const { imdbId, seasonNum, dmmProblemKey, solution, onlyTrusted, maxSize, page } = req.query;

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

	// Impossible titles: no browser session can produce these ids, so a hit is
	// proof of enumeration rather than a signal to weigh. Answer exactly as a
	// never-scraped title does and, crucially, do not queue a scrape for it.
	if (await checkCanary(req, imdbId)) {
		respondAsNeverScraped(res);
		return;
	}
	if (!seasonNum || !(typeof seasonNum === 'string')) {
		res.status(400).json({
			errorMessage: 'Missing "seasonNum" query parameter',
		});
		return;
	}

	try {
		const maxSizeInGB = maxSize ? parseInt(maxSize.toString()) : 0;
		const pageNum = page ? parseInt(page.toString()) : 0;

		const promises = [
			db.getScrapedTrueResults<any[]>(
				`tv:${imdbId.toString().trim()}:${parseInt(seasonNum.toString().trim(), 10)}`,
				maxSizeInGB,
				pageNum
			),
		];
		if (onlyTrusted !== 'true') {
			promises.push(
				db.getScrapedResults<any[]>(
					`tv:${imdbId.toString().trim()}:${parseInt(seasonNum.toString().trim(), 10)}`,
					maxSizeInGB,
					pageNum
				)
			);
		}
		const results = await Promise.all(promises);
		// should contain both results
		let searchResults = [...(results[0] || []), ...(results[1] || [])];

		// An empty page only means "never scraped" when nothing narrowed the query.
		// Later pages run out by design, and maxSize/onlyTrusted can filter a
		// well-scraped season down to nothing - neither should queue a scrape.
		const isUnfilteredFirstPage = pageNum === 0 && maxSizeInGB === 0 && onlyTrusted !== 'true';

		const trimmedImdbId = imdbId.toString().trim();
		const trimmedSeasonNum = parseInt(seasonNum.toString().trim(), 10);
		const debridioTarget = {
			imdbId: trimmedImdbId,
			key: `tv:${trimmedImdbId}:${trimmedSeasonNum}`,
			kind: 'series',
			season: trimmedSeasonNum,
		} satisfies DebridioTarget;

		if (searchResults.length === 0 && isUnfilteredFirstPage) {
			// Debridio answers in about a second what the heavy scrapers queue
			// for minutes, so a first view fills the table on this very request.
			// An empty result (disabled, already in flight, unknown title) falls
			// through to the request queue exactly as before.
			searchResults = await backfillFromDebridioNow(debridioTarget);
			if (searchResults.length > 0) {
				// The heavy scrapers still deepen coverage afterwards.
				await db.saveScrapedResults(`requested:${trimmedImdbId}`, []);
			} else {
				const isProcessing = await db.keyExists(`processing:${trimmedImdbId}`);
				if (isProcessing) {
					res.setHeader('status', 'processing').status(204).end();
					return;
				}

				await db.saveScrapedResults(`requested:${trimmedImdbId}`, []);
				res.setHeader('status', 'requested').status(204).end();
				return;
			}
		}

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
			// Keeps the debridio ⚡ availability markers for this season fresh
			// without holding the response; no-ops inside its TTL.
			void refreshDebridioAvailabilityInBackground(debridioTarget);
			res.status(200).json({ results: processedResults });
		} catch (error: any) {
			console.error(
				'Error filtering reported hashes:',
				error instanceof Error ? error.message : 'Unknown error'
			);
			// If filtering fails, continue with unfiltered results
			let processedResults = flattenAndRemoveDuplicates(searchResults);
			processedResults = sortByFileSize(processedResults);
			res.status(200).json({ results: processedResults });
		}
	} catch (error: any) {
		console.error(
			'Encountered a database issue:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ errorMessage: 'An internal error occurred' });
	}
};

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.torrents);
