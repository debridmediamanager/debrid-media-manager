import { MRating, MShow } from '@/services/mdblist';
import { getMdblistClient } from '@/services/mdblistClient';
import { getMetadataCache } from '@/services/metadataCache';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';
import UserAgent from 'user-agents';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { imdbid } = req.query;

	if (!imdbid || typeof imdbid !== 'string') {
		return res.status(400).json({ error: 'IMDB ID is required' });
	}

	try {
		const mdblistClient = getMdblistClient();
		const metadataCache = getMetadataCache();

		const mdbPromise = mdblistClient.getInfoByImdbId(imdbid);
		const cinePromise = metadataCache.getCinemetaSeries(imdbid, {
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

		const isShowType = (response: any): response is MShow => {
			return 'seasons' in response;
		};

		console.log(`[show.ts] Processing show ${imdbid}:`, {
			hasMdbResponse: !!mdbResponse,
			hasCinemetaResponse: !!cinemetaResponse,
			mdbSeasons: isShowType(mdbResponse) ? mdbResponse.seasons?.length : 'N/A',
			cinemetaVideos: cinemetaResponse.meta?.videos?.length,
		});

		let season_count = 1;
		let season_names = [];
		let imdb_score;

		const allCineVideos =
			cinemetaResponse.meta?.videos.filter((video: any) => video.season >= 0) || [];
		let cineSeasons = allCineVideos.filter((video: any) => video.season > 0);
		const uniqueSeasons: number[] = Array.from(
			new Set(cineSeasons.map((video: any) => video.season))
		);
		const cineSeasonCount = uniqueSeasons.length > 0 ? Math.max(...uniqueSeasons) : 1;

		console.log(`[show.ts] Cinemeta data for ${imdbid}:`, {
			totalVideos: cineSeasons.length,
			uniqueSeasons,
			cineSeasonCount,
		});

		const mdbSeasons = isShowType(mdbResponse)
			? mdbResponse.seasons.filter((season) => season.season_number > 0)
			: [];

		const mdbSeasonCount =
			mdbSeasons.length > 0
				? Math.max(...mdbSeasons.map((season) => season.season_number))
				: 1;
		season_names = mdbSeasons.map((season) => season.name);

		console.log(`[show.ts] MDBList data for ${imdbid}:`, {
			mdbSeasons: mdbSeasons.map((s) => ({ num: s.season_number, name: s.name })),
			mdbSeasonCount,
		});

		if (cineSeasonCount > mdbSeasonCount) {
			season_count = cineSeasonCount;
			const remaining = Array.from(
				{ length: cineSeasonCount - mdbSeasonCount },
				(_, i) => i + 1
			);
			season_names = season_names.concat(
				remaining.map((i) => `Season ${mdbSeasonCount + i}`)
			);
			console.log(
				`[show.ts] Using cinemeta count (${cineSeasonCount}) over mdb count (${mdbSeasonCount})`
			);
		} else {
			season_count = mdbSeasonCount;
			console.log(
				`[show.ts] Using mdb count (${mdbSeasonCount}) over cinemeta count (${cineSeasonCount})`
			);
		}

		imdb_score =
			cinemetaResponse.meta?.imdbRating ??
			mdbResponse.ratings?.reduce((acc: number | undefined, rating: MRating) => {
				if (rating.source === 'imdb') {
					return rating.score as number;
				}
				return acc;
			}, undefined);

		const title = mdbResponse?.title ?? cinemetaResponse?.meta?.name ?? 'Unknown';

		// Check if specials (season 0) exist
		const has_specials =
			allCineVideos.some((video: any) => video.season === 0) ||
			(isShowType(mdbResponse) &&
				mdbResponse.seasons?.some((season) => season.season_number === 0));

		const season_episode_counts: Record<number, number> = {};

		// Get counts from cinemeta (including season 0)
		allCineVideos.forEach((video: any) => {
			if (!season_episode_counts[video.season]) {
				season_episode_counts[video.season] = 1;
			} else {
				season_episode_counts[video.season]++;
			}
		});

		// Merge with mdb data if available
		if (isShowType(mdbResponse) && mdbResponse.seasons) {
			mdbResponse.seasons.forEach((season) => {
				if (season.episode_count && season.season_number != null) {
					// Use the larger count between the two sources
					season_episode_counts[season.season_number] = Math.max(
						season_episode_counts[season.season_number] || 0,
						season.episode_count
					);
				}
			});
		}

		let trailer = mdbResponse?.trailer ?? '';
		let status: string | undefined;
		let next_episode_to_air:
			| { first_aired: string; episode_number: number; season_number: number; name: string }
			| undefined;
		let last_episode_to_air:
			| { first_aired: string; episode_number: number; season_number: number; name: string }
			| undefined;

		if (!trailer && cinemetaResponse.meta?.trailers?.[0]?.source) {
			trailer = `https://youtube.com/watch?v=${cinemetaResponse.meta.trailers[0].source}`;
		}

		// Fetch Trakt next/last episode (accurate datetimes) and TMDB for trailer/status
		const traktNextPromise = metadataCache.getTraktShowEpisode(imdbid, 'next_episode');
		const traktLastPromise = metadataCache.getTraktShowEpisode(imdbid, 'last_episode');
		const tmdbPromise = mdbResponse?.tmdbid
			? (async () => {
					try {
						const tmdbKey = process.env.TMDB_KEY;
						if (!tmdbKey) return null;
						const resp = await axios.get(
							`https://api.themoviedb.org/3/tv/${mdbResponse.tmdbid}?api_key=${tmdbKey}&append_to_response=videos`
						);
						return resp.data;
					} catch {
						return null;
					}
				})()
			: Promise.resolve(null);

		const [traktNext, traktLast, tmdbData] = await Promise.all([
			traktNextPromise,
			traktLastPromise,
			tmdbPromise,
		]);

		if (traktNext?.first_aired) {
			next_episode_to_air = {
				first_aired: traktNext.first_aired,
				episode_number: traktNext.number,
				season_number: traktNext.season,
				name: traktNext.title,
			};
		}
		if (traktLast?.first_aired) {
			last_episode_to_air = {
				first_aired: traktLast.first_aired,
				episode_number: traktLast.number,
				season_number: traktLast.season,
				name: traktLast.title,
			};
		}

		if (tmdbData) {
			status = tmdbData.status;
			if (!trailer) {
				const tmdbTrailer = tmdbData.videos?.results?.find(
					(v: any) => v.type === 'Trailer' && v.site === 'YouTube'
				);
				if (tmdbTrailer?.key) {
					trailer = `https://youtube.com/watch?v=${tmdbTrailer.key}`;
				}
			}
		}

		if (!status) {
			status = mdbResponse?.status;
		}

		const responseData = {
			title,
			description: mdbResponse?.description ?? cinemetaResponse?.meta?.description ?? 'n/a',
			poster: mdbResponse?.poster ?? cinemetaResponse?.meta?.poster ?? '',
			backdrop:
				mdbResponse?.backdrop ??
				cinemetaResponse?.meta?.background ??
				`https://picsum.photos/seed/${encodeURIComponent(title)}/1800/300`,
			season_count,
			season_names,
			has_specials,
			imdb_score: imdb_score ?? 0,
			season_episode_counts,
			trailer,
			status,
			next_episode_to_air,
			last_episode_to_air,
		};

		console.log(`[show.ts] Final response for ${imdbid}:`, {
			season_count: responseData.season_count,
			season_names: responseData.season_names,
			season_episode_counts: responseData.season_episode_counts,
		});

		res.status(200).json(responseData);
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
