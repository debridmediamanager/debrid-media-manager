import { MRating } from '@/services/mdblist';
import { getMdblistClient } from '@/services/mdblistClient';
import { getMetadataCache } from '@/services/metadataCache';
import {
	extractDigitalReleaseDate,
	getExpectedDigitalReleaseDate,
	isIsoDateOnOrBeforeToday,
} from '@/utils/movieReleaseDates';
import { getOmdbMetadata, getOmdbPoster, getOmdbRating, omdbField } from '@/utils/omdb';
import { getTmdbAuth, tmdbAxiosOptions } from '@/utils/tmdbAuth';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';
import UserAgent from 'user-agents';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { imdbid } = req.query;

	if (!imdbid || typeof imdbid !== 'string') {
		return res.status(400).json({ error: 'IMDB ID is required' });
	}

	try {
		const mdblistClient = getMdblistClient();
		const metadataCache = getMetadataCache();

		const mdbPromise = mdblistClient.getInfoByImdbId(imdbid);
		const cinePromise = metadataCache.getCinemetaMovie(imdbid, {
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

		// mdblist scores IMDb out of 100 and Cinemeta out of 10; this route reports
		// out of 100. mdblist is read first because it carries the exact rating
		// Cinemeta has already rounded, and it has one for titles Cinemeta has not
		// rated yet. Neither is guaranteed: a rating can be absent, null, or an
		// empty string that parses to NaN.
		const mdbImdbScore = mdbResponse.ratings?.reduce(
			(acc: number | undefined, rating: MRating) => {
				if (rating.source === 'imdb') {
					return rating.score as number;
				}
				return acc;
			},
			undefined
		);
		const cinemetaImdbScore = parseFloat(cinemetaResponse.meta?.imdbRating) * 10;

		let imdb_score: number | null = Number.isFinite(mdbImdbScore as number)
			? (mdbImdbScore as number)
			: Number.isFinite(cinemetaImdbScore)
				? cinemetaImdbScore
				: null;

		let resolvedTitle: string | undefined =
			mdbResponse.title ?? cinemetaResponse.meta?.name ?? undefined;
		let resolvedDescription: string | undefined =
			mdbResponse.description ?? cinemetaResponse.meta?.description ?? undefined;
		let resolvedPoster: string | undefined =
			mdbResponse.poster ?? cinemetaResponse.meta?.poster ?? undefined;
		let resolvedYear: string | number | undefined =
			mdbResponse.year ?? cinemetaResponse.meta?.releaseInfo ?? undefined;

		// OMDb is the last resort for every field above and the most rate-limited
		// source DMM uses, so it is asked only when one of them is actually missing.
		// On a title mdblist and Cinemeta both know it has nothing to add, and the
		// round trip it costs here is one this request would otherwise have spent on
		// every title. getOmdbMetadata resolves to null rather than rejecting, so it
		// cannot fail the request.
		if (
			imdb_score === null ||
			resolvedTitle === undefined ||
			resolvedDescription === undefined ||
			resolvedPoster === undefined ||
			resolvedYear === undefined
		) {
			const omdbResponse = await getOmdbMetadata(imdbid);
			if (imdb_score === null) {
				const omdbRating = getOmdbRating(omdbResponse);
				imdb_score = omdbRating === null ? null : omdbRating * 10;
			}
			resolvedTitle = resolvedTitle ?? omdbField(omdbResponse?.Title);
			resolvedDescription = resolvedDescription ?? omdbField(omdbResponse?.Plot);
			resolvedPoster = resolvedPoster ?? getOmdbPoster(omdbResponse) ?? undefined;
			resolvedYear = resolvedYear ?? omdbField(omdbResponse?.Year);
		}

		const title = resolvedTitle ?? 'Unknown';

		let trailer = mdbResponse.trailer ?? '';
		let digitalReleaseDate = '';
		let expectedDigitalReleaseDate = '';
		let expectedDigitalReleaseSource: 'tmdb' | 'estimated' | null = null;
		let digitalReleaseAvailable = false;

		if (!trailer && cinemetaResponse.meta?.trailers?.[0]?.source) {
			trailer = `https://youtube.com/watch?v=${cinemetaResponse.meta.trailers[0].source}`;
		}

		if (mdbResponse.tmdbid) {
			try {
				const tmdbAuth = getTmdbAuth();
				if (tmdbAuth) {
					const tmdbResponse = await axios.get(
						`https://api.themoviedb.org/3/movie/${mdbResponse.tmdbid}`,
						tmdbAxiosOptions(tmdbAuth, {
							append_to_response: 'videos,release_dates',
						})
					);
					const tmdbTrailer = tmdbResponse.data.videos?.results?.find(
						(v: any) => v.type === 'Trailer' && v.site === 'YouTube'
					);
					if (!trailer && tmdbTrailer?.key) {
						trailer = `https://youtube.com/watch?v=${tmdbTrailer.key}`;
					}

					digitalReleaseDate = extractDigitalReleaseDate(tmdbResponse.data.release_dates);
					const expectedDigitalRelease = getExpectedDigitalReleaseDate(
						tmdbResponse.data.release_date ?? mdbResponse.released,
						digitalReleaseDate
					);
					expectedDigitalReleaseDate = expectedDigitalRelease.date;
					expectedDigitalReleaseSource = expectedDigitalRelease.source;
					digitalReleaseAvailable = isIsoDateOnOrBeforeToday(expectedDigitalReleaseDate);
				}
			} catch (error) {
				console.error('Error fetching TMDB movie release metadata:', error);
			}
		}

		if (!expectedDigitalReleaseDate) {
			const expectedDigitalRelease = getExpectedDigitalReleaseDate(
				mdbResponse.released,
				digitalReleaseDate
			);
			expectedDigitalReleaseDate = expectedDigitalRelease.date;
			expectedDigitalReleaseSource = expectedDigitalRelease.source;
			digitalReleaseAvailable = isIsoDateOnOrBeforeToday(expectedDigitalReleaseDate);
		}

		return res.status(200).json({
			title,
			description: resolvedDescription ?? 'n/a',
			poster: resolvedPoster ?? '',
			backdrop:
				mdbResponse.backdrop ??
				cinemetaResponse.meta?.background ??
				`https://picsum.photos/seed/${encodeURIComponent(title)}/1800/300`,
			year: resolvedYear ?? '????',
			imdb_score: imdb_score ?? 0,
			trailer,
			digitalReleaseDate,
			expectedDigitalReleaseDate,
			expectedDigitalReleaseSource,
			digitalReleaseAvailable,
		});
	} catch (error) {
		console.error('Error fetching movie info:', error);
		return res.status(200).json({
			title: 'Unknown',
			description: 'n/a',
			poster: '',
			backdrop: 'https://picsum.photos/seed/movie/1800/300',
			year: '????',
			imdb_score: 0,
			trailer: '',
			digitalReleaseDate: '',
			expectedDigitalReleaseDate: '',
			expectedDigitalReleaseSource: null,
			digitalReleaseAvailable: false,
		});
	}
}
