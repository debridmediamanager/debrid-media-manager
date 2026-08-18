import { MShow } from '@/services/mdblist';
import { getMdblistClient } from '@/services/mdblistClient';
import { ScrapeSearchResult, flattenAndRemoveDuplicates } from '@/services/mediasearch';
import { getMetadataCache } from '@/services/metadataCache';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { NextApiHandler } from 'next';
import UserAgent from 'user-agents';
import { validateDmmApiKeyHeader } from './auth';

type Quality = '4k' | '1080p' | '720p' | 'best';

const QUALITY_PATTERNS: Record<string, RegExp> = {
	'4k': /2160p/i,
	'1080p': /1080p/i,
	'720p': /720p/i,
};

function filterByQuality(results: ScrapeSearchResult[], quality: Quality): ScrapeSearchResult[] {
	if (quality === 'best') return results;

	const pattern = QUALITY_PATTERNS[quality];
	if (!pattern) return results;

	return results.filter((t) => pattern.test(t.title));
}

async function searchTorrentsForKey(
	key: string,
	imdbId: string,
	maxSizeGB: number,
	limit: number,
	quality: Quality
): Promise<ScrapeSearchResult[]> {
	const [trustedResults, untrustedResults] = await Promise.all([
		db.getScrapedTrueResults<ScrapeSearchResult[]>(key, maxSizeGB),
		db.getScrapedResults<ScrapeSearchResult[]>(key, maxSizeGB),
	]);

	const combined = [...(trustedResults || []), ...(untrustedResults || [])];
	if (combined.length === 0) return [];

	const reportedHashes = await db.getReportedHashes(imdbId);
	const filtered = combined.filter((t) => t.hash && !reportedHashes.includes(t.hash));

	let processed = flattenAndRemoveDuplicates([filtered]);
	if (processed.length === 0) return [];

	const availableRecords = await db.checkAvailabilityByHashes(processed.map((t) => t.hash));
	const availableSet = new Set(availableRecords.map((r) => r.hash));
	processed = processed.filter((t) => availableSet.has(t.hash));

	processed = filterByQuality(processed, quality);
	processed.sort((a, b) => b.fileSize - a.fileSize);

	return processed.slice(0, limit);
}

async function getSeasonCount(imdbId: string): Promise<number> {
	const mdblistClient = getMdblistClient();
	const metadataCache = getMetadataCache();

	const [mdbResponse, cinemetaResponse] = await Promise.all([
		mdblistClient.getInfoByImdbId(imdbId),
		metadataCache.getCinemetaSeries(imdbId, {
			headers: {
				accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
				'accept-language': 'en-US,en;q=0.5',
				'accept-encoding': 'gzip, deflate, br',
				connection: 'keep-alive',
				'user-agent': new UserAgent().toString(),
			},
		}),
	]);

	const isShowType = (response: any): response is MShow => 'seasons' in response;

	const cineSeasons = (cinemetaResponse.meta?.videos || []).filter((v: any) => v.season > 0);
	const uniqueSeasons: number[] = Array.from(new Set(cineSeasons.map((v: any) => v.season)));
	const cineSeasonCount = uniqueSeasons.length > 0 ? Math.max(...uniqueSeasons) : 1;

	const mdbSeasons = isShowType(mdbResponse)
		? mdbResponse.seasons.filter((s: any) => s.season_number > 0)
		: [];
	const mdbSeasonCount =
		mdbSeasons.length > 0 ? Math.max(...mdbSeasons.map((s: any) => s.season_number)) : 1;

	return Math.max(cineSeasonCount, mdbSeasonCount);
}

const handler: NextApiHandler = async (req, res) => {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	if (!(await validateDmmApiKeyHeader(req, res))) return;

	const { imdbId, mediaType, maxSize, limit, quality } = req.body;

	if (!imdbId || typeof imdbId !== 'string' || !/^tt\d+$/.test(imdbId)) {
		return res.status(400).json({ error: 'Invalid IMDB ID format. Expected: ttXXXXXXX' });
	}

	if (mediaType !== 'movie' && mediaType !== 'tv') {
		return res.status(400).json({ error: 'mediaType must be "movie" or "tv"' });
	}

	const validQualities: Quality[] = ['4k', '1080p', '720p', 'best'];
	const qualityParam: Quality = quality && validQualities.includes(quality) ? quality : 'best';

	const maxSizeGB = maxSize && typeof maxSize === 'number' && maxSize > 0 ? maxSize : 0;
	const resultLimit =
		limit && typeof limit === 'number' && limit > 0 && limit <= 100 ? limit : 20;

	try {
		if (mediaType === 'movie') {
			const results = await searchTorrentsForKey(
				`movie:${imdbId}`,
				imdbId,
				maxSizeGB,
				resultLimit,
				qualityParam
			);

			return res.status(200).json({
				mediaType: 'movie',
				results,
				count: results.length,
			});
		}

		const seasonCount = await getSeasonCount(imdbId);

		const seasonPromises = Array.from({ length: seasonCount }, (_, i) =>
			searchTorrentsForKey(
				`tv:${imdbId}:${i + 1}`,
				imdbId,
				maxSizeGB,
				resultLimit,
				qualityParam
			)
		);

		const seasonResults = await Promise.all(seasonPromises);

		const seasons: Record<number, ScrapeSearchResult[]> = {};
		let totalCount = 0;
		for (let i = 0; i < seasonCount; i++) {
			const results = seasonResults[i];
			if (results.length > 0) {
				seasons[i + 1] = results;
				totalCount += results.length;
			}
		}

		return res.status(200).json({
			mediaType: 'tv',
			seasonCount,
			seasons,
			count: totalCount,
		});
	} catch (error) {
		console.error('Error searching torrents:', error);
		return res.status(500).json({
			error: 'Failed to search torrents',
			details: error instanceof Error ? error.message : 'Unknown error',
		});
	}
};

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.torrents);
