import { getMetadataCache } from '@/services/metadataCache';
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
		console.error('TMDB key missing when requesting show details');
		return res.status(500).json({ message: 'TMDB configuration missing.' });
	}

	if (!traktClientId) {
		console.error('Trakt client id missing when requesting show details');
		return res.status(500).json({ message: 'Trakt configuration missing.' });
	}

	console.info('Fetching show details', { imdbId });

	const metadataCache = getMetadataCache();

	// Every lookup goes through the metadata cache: a page view used to spend a
	// TMDB find, a TMDB detail and one Trakt person search per cast member and
	// creator — up to seventeen uncached requests for the same answer each time.
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

		const tmdbId = findData?.tv_results?.[0]?.id;
		if (!tmdbId) {
			return res.status(404).json({ message: 'Show not found.' });
		}

		const show = await metadataCache.getTmdbTvInfo(tmdbId, 'credits');
		const cast = show.credits?.cast || [];
		const crew = show.credits?.crew || [];

		const topCast = cast.slice(0, 15);
		const enrichedCast: CastMember[] = await Promise.all(
			topCast.map(async (person: any) => ({
				name: person.name,
				character: person.character,
				profilePath: person.profile_path,
				slug: await traktSlugFor(person),
			}))
		);

		const creators = show.created_by || [];
		const enrichedCreators: CrewMember[] = await Promise.all(
			creators.map(async (creator: any) => ({
				name: creator.name,
				job: 'Creator',
				department: 'Production',
				slug: await traktSlugFor(creator),
			}))
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
