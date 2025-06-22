import { MRating, MShow } from '@/services/mdblist';
import { getMdblistClient } from '@/services/mdblistClient';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';
import UserAgent from 'user-agents';

const getCinemetaInfo = (imdbId: string) =>
	`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { imdbid } = req.query;

	if (!imdbid || typeof imdbid !== 'string') {
		return res.status(400).json({ error: 'IMDB ID is required' });
	}

	try {
		const mdblistClient = getMdblistClient();
		const mdbPromise = mdblistClient.getInfoByImdbId(imdbid);
		const cinePromise = axios.get(getCinemetaInfo(imdbid), {
			headers: {
				accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
				'accept-language': 'en-US,en;q=0.5',
				'accept-encoding': 'gzip, deflate, br',
				connection: 'keep-alive',
				'sec-fetch-dest': 'document',
				'sec-fetch-mode': 'navigate',
				'sec-fetch-site': 'same-origin',
				'sec-fetch-user': '?1',
				'upgrade-insecure-requests': '1',
				'user-agent': new UserAgent().toString(),
			},
		});

		const [mdbResponse, cinemetaResponse] = await Promise.all([mdbPromise, cinePromise]);

		let season_count = 1;
		let season_names = [];
		let imdb_score;

		let cineSeasons =
			cinemetaResponse.data.meta?.videos.filter((video: any) => video.season > 0) || [];
		const uniqueSeasons: number[] = Array.from(
			new Set(cineSeasons.map((video: any) => video.season))
		);
		const cineSeasonCount = uniqueSeasons.length > 0 ? Math.max(...uniqueSeasons) : 1;

		// Check if mdbResponse is MShow type by checking if it has seasons property
		const isShowType = (response: any): response is MShow => {
			return 'seasons' in response;
		};

		const mdbSeasons = isShowType(mdbResponse)
			? mdbResponse.seasons.filter((season) => season.season_number > 0)
			: [];

		const mdbSeasonCount =
			mdbSeasons.length > 0
				? Math.max(...mdbSeasons.map((season) => season.season_number))
				: 1;
		season_names = mdbSeasons.map((season) => season.name);

		if (cineSeasonCount > mdbSeasonCount) {
			season_count = cineSeasonCount;
			// add remaining to season_names
			const remaining = Array.from(
				{ length: cineSeasonCount - mdbSeasonCount },
				(_, i) => i + 1
			);
			season_names = season_names.concat(
				remaining.map((i) => `Season ${mdbSeasonCount + i}`)
			);
		} else {
			season_count = mdbSeasonCount;
		}

		imdb_score =
			cinemetaResponse.data.meta?.imdbRating ??
			mdbResponse.ratings?.reduce((acc: number | undefined, rating: MRating) => {
				if (rating.source === 'imdb') {
					return rating.score as number;
				}
				return acc;
			}, undefined);

		const title = mdbResponse?.title ?? cinemetaResponse?.data?.meta?.name ?? 'Unknown';

		const season_episode_counts: Record<number, number> = {};

		// Get counts from cinemeta
		cineSeasons.forEach((video: any) => {
			if (!season_episode_counts[video.season]) {
				season_episode_counts[video.season] = 1;
			} else {
				season_episode_counts[video.season]++;
			}
		});

		// Merge with mdb data if available
		if (isShowType(mdbResponse) && mdbResponse.seasons) {
			mdbResponse.seasons.forEach((season) => {
				if (season.episode_count && season.season_number) {
					// Use the larger count between the two sources
					season_episode_counts[season.season_number] = Math.max(
						season_episode_counts[season.season_number] || 0,
						season.episode_count
					);
				}
			});
		}

		res.status(200).json({
			title,
			description:
				mdbResponse?.description ?? cinemetaResponse?.data?.meta?.description ?? 'n/a',
			poster: mdbResponse?.poster ?? cinemetaResponse?.data?.meta?.poster ?? '',
			backdrop:
				mdbResponse?.backdrop ??
				cinemetaResponse?.data?.meta?.background ??
				'https://source.unsplash.com/random/1800x300?' + title,
			season_count,
			season_names,
			imdb_score: imdb_score ?? 0,
			season_episode_counts,
		});
	} catch (error) {
		if (axios.isAxiosError(error)) {
			console.error('Error fetching show info:', {
				message: error.message,
				status: error.response?.status,
				statusText: error.response?.statusText,
				url: error.config?.url,
			});
		} else {
			console.error('Error fetching show info:', error);
		}
		res.status(500).json({ error: 'Failed to fetch show information' });
	}
}
