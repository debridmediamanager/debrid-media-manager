import { MRating, MShow } from '@/services/mdblist';
import { fetchShowSources } from '@/services/metadata';
import { getOmdbParentSeries, getOmdbPoster, getOmdbRating, omdbField } from '@/utils/omdb';
import {
	mergeShowViews,
	viewFromCinemeta,
	viewFromMdblist,
	viewFromOmdb,
	viewFromTmdb,
	viewFromTrakt,
	viewFromTvmaze,
} from '@/utils/showMetadataMerge';
import { tmdbImageUrl } from '@/utils/tmdb';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';

const isShowType = (response: any): response is MShow =>
	!!response && typeof response === 'object' && Array.isArray(response.seasons);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { imdbid } = req.query;

	if (!imdbid || typeof imdbid !== 'string') {
		return res.status(400).json({ error: 'IMDB ID is required' });
	}

	try {
		// Every provider, each cached and each allowed to fail on its own; the
		// metadata API reads the same rows.
		const sources = await fetchShowSources(imdbid);
		const mdbResponse: any = sources.mdblist;
		const cinemetaResponse: any = sources.cinemeta;
		const omdbResponse: any = sources.omdb;
		const tmdbData: any = sources.tmdb;
		const tvmazeShow = sources.tvmaze;
		const traktSeasons = sources.traktSeasons;
		const traktNext = sources.traktNext;
		const traktLast = sources.traktLast;

		if (
			!mdbResponse &&
			!cinemetaResponse &&
			!tmdbData &&
			!tvmazeShow &&
			!traktSeasons &&
			!omdbResponse
		) {
			throw new Error(`No metadata provider answered for ${imdbid}`);
		}

		const merged = mergeShowViews([
			viewFromTmdb(tmdbData),
			viewFromTvmaze(tvmazeShow),
			viewFromTrakt(traktSeasons, traktNext, traktLast),
			viewFromMdblist(mdbResponse),
			viewFromCinemeta(cinemetaResponse),
			viewFromOmdb(omdbResponse),
		]);

		console.log(`[show.ts] Seasons for ${imdbid}:`, {
			season_count: merged.season_count,
			reach: merged.reach,
			status: merged.status,
		});

		const season_count = merged.season_count;
		const mdbSeasonNames = isShowType(mdbResponse)
			? mdbResponse.seasons
					.filter((season) => season.season_number > 0)
					.sort((a, b) => a.season_number - b.season_number)
					.map((season) => season.name)
					.slice(0, season_count)
			: [];
		const season_names = mdbSeasonNames.concat(
			Array.from(
				{ length: season_count - mdbSeasonNames.length },
				(_, i) => `Season ${mdbSeasonNames.length + i + 1}`
			)
		);

		let imdb_score =
			cinemetaResponse?.meta?.imdbRating ??
			mdbResponse?.ratings?.reduce((acc: number | undefined, rating: MRating) => {
				if (rating.source === 'imdb') {
					return rating.score as number;
				}
				return acc;
			}, undefined);

		// OMDb is the last resort for each of these. Its rating stays on OMDb's
		// native 0-10 scale, as Cinemeta's does; mdblist's above is out of 100.
		imdb_score = imdb_score ?? getOmdbRating(omdbResponse);
		const resolvedTitle: string | undefined =
			mdbResponse?.title ?? cinemetaResponse?.meta?.name ?? omdbField(omdbResponse?.Title);
		const resolvedDescription: string | undefined =
			mdbResponse?.description ??
			cinemetaResponse?.meta?.description ??
			omdbField(omdbResponse?.Plot);
		const resolvedPoster: string | undefined =
			mdbResponse?.poster ??
			cinemetaResponse?.meta?.poster ??
			getOmdbPoster(omdbResponse) ??
			undefined;

		const title = resolvedTitle ?? 'Unknown';

		let trailer = mdbResponse?.trailer ?? '';
		if (!trailer && cinemetaResponse?.meta?.trailers?.[0]?.source) {
			trailer = `https://youtube.com/watch?v=${cinemetaResponse.meta.trailers[0].source}`;
		}
		if (!trailer && tmdbData) {
			const tmdbTrailer = tmdbData.videos?.results?.find(
				(v: any) => v.type === 'Trailer' && v.site === 'YouTube'
			);
			if (tmdbTrailer?.key) {
				trailer = `https://youtube.com/watch?v=${tmdbTrailer.key}`;
			}
		}

		const responseData = {
			title,
			description: resolvedDescription ?? 'n/a',
			// tmdbData is already fetched above for status and the trailer, so its
			// art is a free extra source rather than another round trip.
			poster: resolvedPoster ?? tmdbImageUrl(tmdbData?.poster_path, 'w500') ?? '',
			backdrop:
				mdbResponse?.backdrop ??
				cinemetaResponse?.meta?.background ??
				tmdbImageUrl(tmdbData?.backdrop_path, 'w1280') ??
				`https://picsum.photos/seed/${encodeURIComponent(title)}/1800/300`,
			season_count,
			season_names,
			has_specials: merged.has_specials,
			imdb_score: imdb_score ?? 0,
			season_episode_counts: merged.season_episode_counts,
			trailer,
			status: merged.status,
			next_episode_to_air: merged.next_episode_to_air,
			last_episode_to_air: merged.last_episode_to_air,
			// Set when the id is an episode's; the season page moves to the series.
			series_imdbid: getOmdbParentSeries(omdbResponse, imdbid) ?? undefined,
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
