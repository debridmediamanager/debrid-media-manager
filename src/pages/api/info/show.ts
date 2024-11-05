import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';
import UserAgent from 'user-agents';

const mdblistKey = process.env.MDBLIST_KEY;
const getMdbInfo = (imdbId: string) => `https://mdblist.com/api/?apikey=${mdblistKey}&i=${imdbId}`;
const getCinemetaInfo = (imdbId: string) =>
	`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { imdbid } = req.query;

	if (!imdbid || typeof imdbid !== 'string') {
		return res.status(400).json({ error: 'IMDB ID is required' });
	}

	try {
		const mdbPromise = axios.get(getMdbInfo(imdbid));
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

		let mdbSeasons =
			mdbResponse.data.seasons?.filter((season: any) => season.season_number > 0) || [];
		const mdbSeasonCount =
			mdbSeasons.length > 0
				? Math.max(...mdbSeasons.map((season: any) => season.season_number))
				: 1;
		season_names = mdbSeasons.map((season: any) => season.name);

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
			mdbResponse.data.ratings?.reduce((acc: number | undefined, rating: any) => {
				if (rating.source === 'imdb') {
					return rating.score as number;
				}
				return acc;
			}, null);

		const title = mdbResponse?.data?.title ?? cinemetaResponse?.data?.title ?? 'Unknown';

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
		if (mdbResponse.data.seasons) {
			mdbResponse.data.seasons.forEach((season: any) => {
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
				mdbResponse?.data?.description ?? cinemetaResponse?.data?.description ?? 'n/a',
			poster: mdbResponse?.data?.poster ?? cinemetaResponse?.data?.poster ?? '',
			backdrop:
				mdbResponse?.data?.backdrop ??
				cinemetaResponse?.data?.background ??
				'https://source.unsplash.com/random/1800x300?' + title,
			season_count,
			season_names,
			imdb_score: imdb_score ?? 0,
			season_episode_counts,
		});
	} catch (error) {
		console.error('Error fetching show info:', error);
		res.status(500).json({ error: 'Failed to fetch show information' });
	}
}
