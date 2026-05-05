import {
	extractDigitalReleaseDate,
	getExpectedDigitalReleaseDate,
	isIsoDateOnOrBeforeToday,
} from '@/utils/movieReleaseDates';
import axios from 'axios';
import type { NextApiRequest, NextApiResponse } from 'next';
import getConfig from 'next/config';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TRAKT_BASE_URL = 'https://api.trakt.tv';
const { publicRuntimeConfig } = getConfig();

const resolveTmdbKey = () => process.env.TMDB_KEY;
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

	const tmdbKey = resolveTmdbKey();
	const traktClientId = resolveTraktClientId();

	if (!tmdbKey) {
		console.error('TMDB key missing when requesting movie details');
		return res.status(500).json({ message: 'TMDB configuration missing.' });
	}

	if (!traktClientId) {
		console.error('Trakt client id missing when requesting movie details');
		return res.status(500).json({ message: 'Trakt configuration missing.' });
	}

	console.info('Fetching movie details', { imdbId });

	try {
		const findResponse = await axios.get(`${TMDB_BASE_URL}/find/${imdbId}`, {
			params: {
				api_key: tmdbKey,
				external_source: 'imdb_id',
			},
		});

		const tmdbId = findResponse.data.movie_results?.[0]?.id;
		if (!tmdbId) {
			return res.status(404).json({ message: 'Movie not found.' });
		}

		const detailsResponse = await axios.get(`${TMDB_BASE_URL}/movie/${tmdbId}`, {
			params: {
				api_key: tmdbKey,
				append_to_response: 'credits,release_dates',
			},
		});

		const movie = detailsResponse.data;
		const digitalReleaseDate = extractDigitalReleaseDate(movie.release_dates);
		const expectedDigitalRelease = getExpectedDigitalReleaseDate(
			movie.release_date,
			digitalReleaseDate
		);
		const cast = movie.credits?.cast || [];
		const crew = movie.credits?.crew || [];

		const topCast = cast.slice(0, 15);
		const enrichedCast: CastMember[] = await Promise.all(
			topCast.map(async (person: any) => {
				try {
					const searchResponse = await axios.get(`${TRAKT_BASE_URL}/search/person`, {
						headers: {
							'Content-Type': 'application/json',
							'trakt-api-version': '2',
							'trakt-api-key': traktClientId,
						},
						params: {
							query: person.name,
						},
					});

					const traktPerson = searchResponse.data[0]?.person;
					const slug = traktPerson?.ids?.tmdb === person.id ? traktPerson.ids.slug : null;

					return {
						name: person.name,
						character: person.character,
						profilePath: person.profile_path,
						slug,
					};
				} catch (error) {
					console.warn('Failed to fetch Trakt slug for cast member', {
						name: person.name,
						error,
					});
					return {
						name: person.name,
						character: person.character,
						profilePath: person.profile_path,
						slug: null,
					};
				}
			})
		);

		const director = crew.find((person: any) => person.job === 'Director');
		let enrichedDirector: CrewMember | null = null;

		if (director) {
			try {
				const searchResponse = await axios.get(`${TRAKT_BASE_URL}/search/person`, {
					headers: {
						'Content-Type': 'application/json',
						'trakt-api-version': '2',
						'trakt-api-key': traktClientId,
					},
					params: {
						query: director.name,
					},
				});

				const traktPerson = searchResponse.data[0]?.person;
				const slug = traktPerson?.ids?.tmdb === director.id ? traktPerson.ids.slug : null;

				enrichedDirector = {
					name: director.name,
					job: director.job,
					department: director.department,
					slug,
				};
			} catch (error) {
				console.warn('Failed to fetch Trakt slug for director', {
					name: director.name,
					error,
				});
				enrichedDirector = {
					name: director.name,
					job: director.job,
					department: director.department,
					slug: null,
				};
			}
		}

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
