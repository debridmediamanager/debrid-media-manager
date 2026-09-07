import { getTmdbAuth, tmdbAxiosOptions } from '@/utils/tmdbAuth';
import axios from 'axios';
import type { NextApiRequest, NextApiResponse } from 'next';
import getConfig from 'next/config';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TRAKT_BASE_URL = 'https://api.trakt.tv';
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
		console.error('TMDB key missing when requesting show details');
		return res.status(500).json({ message: 'TMDB configuration missing.' });
	}

	if (!traktClientId) {
		console.error('Trakt client id missing when requesting show details');
		return res.status(500).json({ message: 'Trakt configuration missing.' });
	}

	console.info('Fetching show details', { imdbId });

	try {
		const findResponse = await axios.get(`${TMDB_BASE_URL}/find/${imdbId}`, {
			...tmdbAxiosOptions(tmdbAuth, {
				external_source: 'imdb_id',
			}),
		});

		const tmdbId = findResponse.data.tv_results?.[0]?.id;
		if (!tmdbId) {
			return res.status(404).json({ message: 'Show not found.' });
		}

		const detailsResponse = await axios.get(`${TMDB_BASE_URL}/tv/${tmdbId}`, {
			...tmdbAxiosOptions(tmdbAuth, {
				append_to_response: 'credits',
			}),
		});

		const show = detailsResponse.data;
		const cast = show.credits?.cast || [];
		const crew = show.credits?.crew || [];

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

		const creators = show.created_by || [];
		const enrichedCreators: CrewMember[] = await Promise.all(
			creators.map(async (creator: any) => {
				try {
					const searchResponse = await axios.get(`${TRAKT_BASE_URL}/search/person`, {
						headers: {
							'Content-Type': 'application/json',
							'trakt-api-version': '2',
							'trakt-api-key': traktClientId,
						},
						params: {
							query: creator.name,
						},
					});

					const traktPerson = searchResponse.data[0]?.person;
					const slug =
						traktPerson?.ids?.tmdb === creator.id ? traktPerson.ids.slug : null;

					return {
						name: creator.name,
						job: 'Creator',
						department: 'Production',
						slug,
					};
				} catch (error) {
					console.warn('Failed to fetch Trakt slug for creator', {
						name: creator.name,
						error,
					});
					return {
						name: creator.name,
						job: 'Creator',
						department: 'Production',
						slug: null,
					};
				}
			})
		);

		return res.status(200).json({
			title: show.name,
			overview: show.overview,
			firstAirDate: show.first_air_date,
			lastAirDate: show.last_air_date,
			numberOfSeasons: show.number_of_seasons,
			numberOfEpisodes: show.number_of_episodes,
			genres: show.genres,
			voteAverage: show.vote_average,
			voteCount: show.vote_count,
			posterPath: show.poster_path,
			backdropPath: show.backdrop_path,
			status: show.status,
			type: show.type,
			cast: enrichedCast,
			creators: enrichedCreators,
		});
	} catch (error: unknown) {
		const status = axios.isAxiosError(error) ? (error.response?.status ?? 500) : 500;
		const message = axios.isAxiosError(error)
			? error.response?.data || error.message
			: error instanceof Error
				? error.message
				: 'Unknown error';

		console.error('Failed to fetch show details', { imdbId, status, error: message });
		return res.status(status).json({ message: 'Failed to fetch show details.' });
	}
}
