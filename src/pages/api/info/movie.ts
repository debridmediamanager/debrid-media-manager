import { MRating } from '@/services/mdblist';
import { fetchMovieSources } from '@/services/metadata';
import { mergeMovieRecord } from '@/utils/metadataRecord';
import {
	extractDigitalReleaseDate,
	getExpectedDigitalReleaseDate,
	isIsoDateOnOrBeforeToday,
} from '@/utils/movieReleaseDates';
import { getOmdbMetadata, getOmdbPoster, getOmdbRating, omdbField } from '@/utils/omdb';
import { tmdbImageUrl } from '@/utils/tmdb';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { imdbid } = req.query;

	if (!imdbid || typeof imdbid !== 'string') {
		return res.status(400).json({ error: 'IMDB ID is required' });
	}

	try {
		// Every provider but OMDb, each cached and each allowed to fail on its own;
		// the metadata API reads the same rows. OMDb is asked below, only when a
		// field is still missing.
		const sources = await fetchMovieSources(imdbid, { omdb: Promise.resolve(null) });
		const mdbResponse: any = sources.mdblist ?? {};
		const cinemetaResponse: any = sources.cinemeta ?? {};
		const record = mergeMovieRecord(imdbid, sources);

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

		const anyAnswered = record.sources.length > 0;
		let resolvedTitle: string | undefined = anyAnswered ? record.title : undefined;
		let resolvedDescription: string | undefined =
			mdbResponse.description ?? cinemetaResponse.meta?.description ?? undefined;
		let resolvedPoster: string | undefined =
			mdbResponse.poster ?? cinemetaResponse.meta?.poster ?? undefined;
		// The original release year, which is what release names and Plex use;
		// OMDb and Cinemeta give the US release (Spirited Away: 2003, not 2001).
		let resolvedYear: string | number | undefined = record.year ?? undefined;

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

		if (!anyAnswered && resolvedTitle === undefined) {
			throw new Error(`No metadata provider answered for ${imdbid}`);
		}
		const title = resolvedTitle ?? 'Unknown';

		let trailer = mdbResponse.trailer ?? '';
		let digitalReleaseDate = '';
		let expectedDigitalReleaseDate = '';
		let expectedDigitalReleaseSource: 'tmdb' | 'estimated' | null = null;
		let digitalReleaseAvailable = false;
		// Art from the same TMDB response the release dates come from, so reading
		// it costs no extra request.
		let tmdbPosterPath: string | null = null;
		let tmdbBackdropPath: string | null = null;

		if (!trailer && cinemetaResponse.meta?.trailers?.[0]?.source) {
			trailer = `https://youtube.com/watch?v=${cinemetaResponse.meta.trailers[0].source}`;
		}

		const tmdbData: any = sources.tmdb;
		if (tmdbData) {
			tmdbPosterPath = tmdbData.poster_path ?? null;
			tmdbBackdropPath = tmdbData.backdrop_path ?? null;

			const tmdbTrailer = tmdbData.videos?.results?.find(
				(v: any) => v.type === 'Trailer' && v.site === 'YouTube'
			);
			if (!trailer && tmdbTrailer?.key) {
				trailer = `https://youtube.com/watch?v=${tmdbTrailer.key}`;
			}

			digitalReleaseDate = extractDigitalReleaseDate(tmdbData.release_dates);
			const expectedDigitalRelease = getExpectedDigitalReleaseDate(
				tmdbData.release_date ?? mdbResponse.released,
				digitalReleaseDate
			);
			expectedDigitalReleaseDate = expectedDigitalRelease.date;
			expectedDigitalReleaseSource = expectedDigitalRelease.source;
			digitalReleaseAvailable = isIsoDateOnOrBeforeToday(expectedDigitalReleaseDate);
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
			poster: resolvedPoster ?? tmdbImageUrl(tmdbPosterPath, 'w500') ?? '',
			backdrop:
				mdbResponse.backdrop ??
				cinemetaResponse.meta?.background ??
				tmdbImageUrl(tmdbBackdropPath, 'w1280') ??
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
