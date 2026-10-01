import { getMetadataCache } from '@/services/metadataCache';
import {
	extractDigitalReleaseDate,
	getExpectedDigitalReleaseDate,
	isIsoDateOnOrBeforeToday,
} from '@/utils/movieReleaseDates';
import { getTmdbAuth } from '@/utils/tmdbAuth';
import axios from 'axios';
import type { NextApiRequest, NextApiResponse } from 'next';
import getConfig from 'next/config';

const { publicRuntimeConfig } = getConfig();

// The v4 read token authenticates by header; the v3 key by query parameter.
const resolveTmdbAuth = () => getTmdbAuth();
const resolveTraktClientId = () => {
	return process.env.TRAKT_CLIENT_ID || publicRuntimeConfig?.traktClientId;
};

type CastMember = {
	name: string;
	character: string;
	profilePath: string | null;
	slug: string | null;
};

type CrewMember = {
	name: string;
	job: string;
	department: string;
	slug: string | null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ message: 'Method Not Allowed' });
	}

	const imdbId = Array.isArray(req.query.imdbId) ? req.query.imdbId[0] : req.query.imdbId;

	if (!imdbId) {
		return res.status(400).json({ message: 'Missing imdbId query parameter.' });
	}

	const tmdbAuth = resolveTmdbAuth();
	const traktClientId = resolveTraktClientId();

	if (!tmdbAuth) {
		console.error('TMDB key missing when requesting movie details');
		return res.status(500).json({ message: 'TMDB configuration missing.' });
	}

	if (!traktClientId) {
		console.error('Trakt client id missing when requesting movie details');
		return res.status(500).json({ message: 'Trakt configuration missing.' });
	}

	console.info('Fetching movie details', { imdbId });

	const metadataCache = getMetadataCache();

	// Every lookup goes through the metadata cache: a page view used to spend a
	// TMDB find, a TMDB detail and one Trakt person search per cast member and
	// the director — up to seventeen uncached requests for the same answer.
	const traktSlugFor = async (person: { name: string; id: number }) => {
		try {
			const traktPerson = await metadataCache.searchTraktPerson(person.name);
			return traktPerson?.ids?.tmdb === person.id ? (traktPerson.ids.slug ?? null) : null;
		} catch (error) {
			console.warn('Failed to fetch Trakt slug', { name: person.name, error });
			return null;
		}
	};

	try {
		const findData = await metadataCache.searchTmdbByImdb(imdbId);

		const tmdbId = findData?.movie_results?.[0]?.id;
		if (!tmdbId) {
			return res.status(404).json({ message: 'Movie not found.' });
		}

		const movie = await metadataCache.getTmdbMovieInfo(tmdbId, 'credits,release_dates');
		const digitalReleaseDate = extractDigitalReleaseDate(movie.release_dates);
		const expectedDigitalRelease = getExpectedDigitalReleaseDate(
			movie.release_date,
			digitalReleaseDate
		);
		const cast = movie.credits?.cast || [];
		const crew = movie.credits?.crew || [];

		const topCast = cast.slice(0, 15);
		const enrichedCast: CastMember[] = await Promise.all(
			topCast.map(async (person: any) => ({
				name: person.name,
				character: person.character,
				profilePath: person.profile_path,
				slug: await traktSlugFor(person),
			}))
		);

		const director = crew.find((person: any) => person.job === 'Director');
		const enrichedDirector: CrewMember | null = director
			? {
					name: director.name,
					job: director.job,
					department: director.department,
					slug: await traktSlugFor(director),
				}
			: null;

		return res.status(200).json({
			title: movie.title,
			overview: movie.overview,
			releaseDate: movie.release_date,
			digitalReleaseDate,
			expectedDigitalReleaseDate: expectedDigitalRelease.date,
			expectedDigitalReleaseSource: expectedDigitalRelease.source,
			digitalReleaseAvailable: isIsoDateOnOrBeforeToday(expectedDigitalRelease.date),
			runtime: movie.runtime,
			genres: movie.genres,
			voteAverage: movie.vote_average,
			voteCount: movie.vote_count,
			posterPath: movie.poster_path,
			backdropPath: movie.backdrop_path,
			cast: enrichedCast,
			director: enrichedDirector,
		});
	} catch (error: unknown) {
		const status = axios.isAxiosError(error) ? (error.response?.status ?? 500) : 500;
		const message = axios.isAxiosError(error)
			? error.response?.data || error.message
			: error instanceof Error
				? error.message
				: 'Unknown error';

		console.error('Failed to fetch movie details', { imdbId, status, error: message });
		return res.status(status).json({ message: 'Failed to fetch movie details.' });
	}
}
