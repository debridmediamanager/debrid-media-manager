import { MShow } from '@/services/mdblist';
import { getMdblistClient } from '@/services/mdblistClient';
import { getMetadataCache } from '@/services/metadataCache';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { NextApiHandler } from 'next';
import UserAgent from 'user-agents';
import { validateDmmApiKeyHeader } from './auth';

const handler: NextApiHandler = async (req, res) => {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	if (!(await validateDmmApiKeyHeader(req, res))) return;

	const { imdbId } = req.body;

	if (!imdbId || typeof imdbId !== 'string' || !/^tt\d+$/.test(imdbId)) {
		return res.status(400).json({ error: 'Invalid IMDB ID format. Expected: ttXXXXXXX' });
	}

	try {
		const mdblistClient = getMdblistClient();
		const metadataCache = getMetadataCache();

		const [mdbResponse, cinemetaResponse] = await Promise.all([
			mdblistClient.getInfoByImdbId(imdbId, 'show'),
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

		const isShowType = (response: any): response is MShow => {
			return 'seasons' in response;
		};

		const allCineVideos =
			cinemetaResponse.meta?.videos.filter((video: any) => video.season >= 0) || [];
		const cineSeasons = allCineVideos.filter((video: any) => video.season > 0);
		const uniqueSeasons: number[] = Array.from(
			new Set(cineSeasons.map((video: any) => video.season))
		);
		const cineSeasonCount = uniqueSeasons.length > 0 ? Math.max(...uniqueSeasons) : 1;

		const mdbSeasons = isShowType(mdbResponse)
			? mdbResponse.seasons.filter((season: any) => season.season_number > 0)
			: [];
		const mdbSeasonCount =
			mdbSeasons.length > 0
				? Math.max(...mdbSeasons.map((season: any) => season.season_number))
				: 1;

		const seasonCount = Math.max(cineSeasonCount, mdbSeasonCount);

		const hasSpecials =
			allCineVideos.some((video: any) => video.season === 0) ||
			(isShowType(mdbResponse) &&
				mdbResponse.seasons?.some((season: any) => season.season_number === 0));

		const title = mdbResponse?.title ?? cinemetaResponse?.meta?.name ?? 'Unknown';

		return res.status(200).json({
			title,
			imdbId,
			seasonCount,
			hasSpecials: !!hasSpecials,
		});
	} catch (error) {
		console.error('Error fetching show info:', error);
		return res.status(500).json({
			error: 'Failed to fetch show info',
			details: error instanceof Error ? error.message : 'Unknown error',
		});
	}
};

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.zurg);
