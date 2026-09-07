import { getTmdbAuth, tmdbAxiosOptions, type TmdbAuth } from '@/utils/tmdbAuth';
import axios from 'axios';
import type { NextApiRequest, NextApiResponse } from 'next';
import getConfig from 'next/config';

const TRAKT_BASE_URL = 'https://api.trakt.tv';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const { publicRuntimeConfig } = getConfig();

const resolveTraktClientId = () => {
	return process.env.TRAKT_CLIENT_ID || publicRuntimeConfig?.traktClientId;
};

// The v4 read token authenticates by header; the v3 key by query parameter.
const resolveTmdbAuth = () => getTmdbAuth();

type MediaType = 'movie' | 'show';

type MediaItem = {
	title: string;
	year: number;
	ids: {
		imdb: string;
	};
};

const extractYear = (dateString?: string | null) => {
	if (!dateString) return 0;
	const year = Number.parseInt(dateString.slice(0, 4), 10);
	return Number.isNaN(year) ? 0 : year;
};

const fetchRelatedFromTrakt = async (
	mediaType: MediaType,
	imdbId: string,
	traktClientId: string
) => {
	const endpoint = `${TRAKT_BASE_URL}/${mediaType}s/${imdbId}/related`;
	const response = await axios.get<MediaItem[]>(endpoint, {
		headers: {
			'Content-Type': 'application/json',
			'trakt-api-version': '2',
			'trakt-api-key': traktClientId,
		},
	});
	return { endpoint, results: response.data };
};

const fetchRelatedFromTmdb = async (
	mediaType: MediaType,
	imdbId: string,
	tmdbAuth: TmdbAuth
): Promise<MediaItem[]> => {
	const findResponse = await axios.get(`${TMDB_BASE_URL}/find/${imdbId}`, {
		...tmdbAxiosOptions(tmdbAuth, {
			external_source: 'imdb_id',
		}),
	});

	const findData = findResponse.data ?? {};
	const tmdbId =
		mediaType === 'movie' ? findData.movie_results?.[0]?.id : findData.tv_results?.[0]?.id;
	if (!tmdbId) {
		console.warn('TMDB fallback could not resolve TMDB id', { mediaType, imdbId });
		return [];
	}

	const similarResponse = await axios.get(
		`${TMDB_BASE_URL}/${mediaType === 'movie' ? 'movie' : 'tv'}/${tmdbId}/similar`,
		{
			...tmdbAxiosOptions(tmdbAuth, {}),
		}
	);

	const similarResults: Array<Record<string, any>> = similarResponse.data?.results ?? [];
	if (!similarResults.length) return [];

	const detailRequests = similarResults.slice(0, 10).map(async (item) => {
		try {
			const detailResponse = await axios.get(
				`${TMDB_BASE_URL}/${mediaType === 'movie' ? 'movie' : 'tv'}/${item.id}`,
				{
					...tmdbAxiosOptions(tmdbAuth, {
						append_to_response: 'external_ids',
					}),
				}
			);
			const detail = detailResponse.data ?? {};
			const imdb = detail.external_ids?.imdb_id;
			if (!imdb) {
				return null;
			}
			const titleField =
				mediaType === 'movie'
					? (item.title ?? detail.title ?? detail.name)
					: (item.name ?? detail.name ?? detail.title);
			const dateField =
				mediaType === 'movie'
					? (item.release_date ?? detail.release_date ?? detail.first_air_date)
					: (item.first_air_date ?? detail.first_air_date ?? detail.release_date);
			return {
				title: titleField ?? 'Untitled',
				year: extractYear(dateField),
				ids: { imdb },
			} satisfies MediaItem;
		} catch (error) {
			console.error('TMDB fallback failed to hydrate item', {
				mediaType,
				imdbId,
				itemId: item.id,
				error,
			});
			return null;
		}
	});

	const hydrated = await Promise.all(detailRequests);
	return hydrated.filter((item): item is MediaItem => Boolean(item));
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ message: 'Method Not Allowed' });
	}

	const mediaTypeParam = Array.isArray(req.query.mediaType)
		? req.query.mediaType[0]
		: req.query.mediaType;
	const imdbId = Array.isArray(req.query.imdbId) ? req.query.imdbId[0] : req.query.imdbId;

	if (!mediaTypeParam || (mediaTypeParam !== 'movie' && mediaTypeParam !== 'show')) {
		return res.status(400).json({ message: 'Invalid mediaType. Expected "movie" or "show".' });
	}

	if (!imdbId) {
		return res.status(400).json({ message: 'Missing imdbId query parameter.' });
	}

	const traktClientId = resolveTraktClientId();
	const tmdbAuth = resolveTmdbAuth();
	let traktErrorStatus: number | null = null;

	if (!traktClientId) {
		console.error('Trakt client id missing when requesting related media');
		return res.status(500).json({ message: 'Trakt configuration missing.' });
	}

	console.info('Fetching related media from Trakt', {
		mediaTypeParam,
		imdbId,
		endpoint: `${TRAKT_BASE_URL}/${mediaTypeParam}s/${imdbId}/related`,
	});

	try {
		const { endpoint, results } = await fetchRelatedFromTrakt(
			mediaTypeParam,
			imdbId,
			traktClientId
		);
		if (results.length > 0) {
			return res.status(200).json({ results, source: 'trakt' });
		}
		console.warn('Trakt returned no related media, attempting fallback', {
			mediaTypeParam,
			imdbId,
			endpoint,
		});
	} catch (error: unknown) {
		const status = axios.isAxiosError(error) ? (error.response?.status ?? 500) : 500;
		const message = axios.isAxiosError(error)
			? error.response?.data || error.message
			: error instanceof Error
				? error.message
				: 'Unknown error';
		traktErrorStatus = status;
		console.error('Failed to fetch related media from Trakt', {
			mediaTypeParam,
			imdbId,
			status,
			error: message,
		});
	}

	if (tmdbAuth) {
		try {
			console.info('Attempting TMDB fallback for related media', { mediaTypeParam, imdbId });
			const tmdbResults = await fetchRelatedFromTmdb(mediaTypeParam, imdbId, tmdbAuth);
			if (tmdbResults.length > 0) {
				return res.status(200).json({
					results: tmdbResults,
					source: 'tmdb',
					message: `Fetched related ${mediaTypeParam === 'movie' ? 'movies' : 'shows'} via TMDB fallback.`,
				});
			}
			console.warn('TMDB fallback returned no results', { mediaTypeParam, imdbId });
		} catch (fallbackError) {
			console.error('TMDB fallback failed', { mediaTypeParam, imdbId, error: fallbackError });
		}
	} else {
		console.warn('TMDB fallback unavailable because TMDB key is missing');
	}

	const message =
		traktErrorStatus && traktErrorStatus >= 500
			? 'Related media temporarily unavailable. Please try again later.'
			: 'No related media found.';

	return res.status(200).json({ results: [], source: 'none', message });
}
