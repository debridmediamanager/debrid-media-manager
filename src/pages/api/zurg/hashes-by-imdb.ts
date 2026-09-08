import { SizeFilters, SubstringFilters } from '@/services/database/hashSearch';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Hashes handed back per request, and the default when the caller names none.
 *
 * The search behind this runs Available, then Cast, then Scraped, stopping as
 * soon as it has enough — so a low ceiling costs the tail of the list rather
 * than the pick of it, and a caller wanting different hashes is better served
 * by narrowing `sizeFilters` / `substringFilters` than by asking for more.
 */
const MAX_LIMIT = 10;

function isValidImdbId(imdbId: string): boolean {
	return /^tt\d+$/.test(imdbId);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	try {
		const { imdbId, sizeFilters, substringFilters, limit } = req.body;

		// Authentication validation - check for x-api-key header
		const authHeader = req.headers['x-api-key'];
		if (!authHeader || typeof authHeader !== 'string') {
			return res.status(401).json({ error: 'Missing x-api-key header' });
		}

		// Validate the API key
		const isValid = await db.validateZurgApiKey(authHeader);
		if (!isValid) {
			return res.status(401).json({ error: 'Invalid or expired API key' });
		}

		// Validate IMDB ID
		if (!imdbId || !isValidImdbId(imdbId)) {
			return res
				.status(400)
				.json({ error: 'Invalid IMDB ID format. Expected format: ttXXXXXXX' });
		}

		// Validate limit. Anything above the ceiling is clamped rather than
		// refused: a caller that has been asking for fifty since before the
		// ceiling existed should get ten, not a 400 that reads as the endpoint
		// having broken.
		const requested = limit ?? MAX_LIMIT;
		if (typeof requested !== 'number' || !Number.isFinite(requested) || requested < 1) {
			return res.status(400).json({ error: 'Limit must be a number of at least 1' });
		}
		const hashLimit = Math.min(Math.trunc(requested), MAX_LIMIT);

		// Validate sizeFilters if provided
		let validatedSizeFilters: SizeFilters | undefined;
		if (sizeFilters) {
			if (typeof sizeFilters !== 'object' || sizeFilters === null) {
				return res.status(400).json({ error: 'sizeFilters must be an object' });
			}

			const { min, max } = sizeFilters;

			if (min !== undefined && (typeof min !== 'number' || min <= 0)) {
				return res.status(400).json({
					error: 'sizeFilters.min must be a positive number (in GB)',
				});
			}

			if (max !== undefined && (typeof max !== 'number' || max <= 0)) {
				return res.status(400).json({
					error: 'sizeFilters.max must be a positive number (in GB)',
				});
			}

			if (min !== undefined && max !== undefined && min > max) {
				return res.status(400).json({
					error: 'sizeFilters.min cannot be greater than sizeFilters.max',
				});
			}

			validatedSizeFilters = { min, max };
		}

		// Validate substringFilters if provided
		let validatedSubstringFilters: SubstringFilters | undefined;
		if (substringFilters) {
			if (typeof substringFilters !== 'object' || substringFilters === null) {
				return res.status(400).json({ error: 'substringFilters must be an object' });
			}

			const { blacklist, whitelist } = substringFilters;

			if (blacklist !== undefined) {
				if (!Array.isArray(blacklist) || blacklist.length === 0) {
					return res.status(400).json({
						error: 'substringFilters.blacklist must be a non-empty array of strings',
					});
				}

				if (!blacklist.every((s) => typeof s === 'string')) {
					return res.status(400).json({
						error: 'All items in substringFilters.blacklist must be strings',
					});
				}
			}

			if (whitelist !== undefined) {
				if (!Array.isArray(whitelist) || whitelist.length === 0) {
					return res.status(400).json({
						error: 'substringFilters.whitelist must be a non-empty array of strings',
					});
				}

				if (!whitelist.every((s) => typeof s === 'string')) {
					return res.status(400).json({
						error: 'All items in substringFilters.whitelist must be strings',
					});
				}
			}

			if (!blacklist && !whitelist) {
				return res.status(400).json({
					error: 'substringFilters must contain at least one of: blacklist or whitelist',
				});
			}

			validatedSubstringFilters = { blacklist, whitelist };
		}

		// Query hashes using the HashSearchService
		const results = await db.getHashesByImdbId({
			imdbId,
			sizeFilters: validatedSizeFilters,
			substringFilters: validatedSubstringFilters,
			limit: hashLimit,
		});

		// Calculate source breakdown
		const sources = {
			available: results.filter((r) => r.source === 'available').length,
			cast: results.filter((r) => r.source === 'cast').length,
			scraped: results.filter((r) => r.source === 'scraped').length,
		};

		return res.status(200).json({
			hashes: results,
			count: results.length,
			sources,
		});
	} catch (error) {
		console.error('Error fetching hashes by IMDB ID:', error);
		return res.status(500).json({
			error: 'Failed to fetch hashes',
			details: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.zurg);
