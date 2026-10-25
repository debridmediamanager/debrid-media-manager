import axios from 'axios';
import type { NextApiRequest, NextApiResponse } from 'next';
import getConfig from 'next/config';

const TRAKT_BASE_URL = 'https://api.trakt.tv';
const { publicRuntimeConfig } = getConfig();

const resolveTraktClientId = () => {
	return process.env.TRAKT_CLIENT_ID || publicRuntimeConfig?.traktClientId;
};

type MovieCredit = {
	character: string;
	movie: {
		title: string;
		year: number;
		ids: {
			trakt: number;
			slug: string;
			imdb: string;
			tmdb: number;
		};
	};
};

type ShowCredit = {
	character: string;
	show: {
		title: string;
		year: number;
		ids: {
			trakt: number;
			slug: string;
			imdb: string;
			tmdb: number;
		};
	};
};

type TraktMovieCreditsResponse = {
	cast: MovieCredit[];
	crew: Record<string, any[]>;
};

type TraktShowCreditsResponse = {
	cast: ShowCredit[];
	crew: Record<string, any[]>;
};

type MediaItem = {
	title: string;
	year: number;
	character?: string;
	job?: string;
	mediaType: 'movie' | 'show';
	creditType: 'cast' | 'crew';
	ids: {
		imdb: string;
	};
};

// Trakt groups crew credits by department; show them as role names.
const DEPARTMENT_LABELS: Record<string, string> = {
	'created by': 'Creator',
	directing: 'Director',
	writing: 'Writer',
	production: 'Producer',
	crew: 'Crew',
	sound: 'Sound',
	camera: 'Camera',
	editing: 'Editor',
	art: 'Art',
	lighting: 'Lighting',
	'visual effects': 'Visual Effects',
	'costume & make-up': 'Costume & Make-Up',
};
const ROLE_ORDER = ['Creator', 'Director', 'Writer', 'Producer'];

const departmentLabel = (department: string) =>
	DEPARTMENT_LABELS[department] ?? department.charAt(0).toUpperCase() + department.slice(1);

const rolePriority = (role: string) => {
	const index = ROLE_ORDER.indexOf(role);
	return index === -1 ? ROLE_ORDER.length : index;
};

// The display name keeps punctuation the slug drops ("Samuel L. Jackson"); it is optional.
const fetchPersonName = async (personSlug: string, headers: Record<string, string>) => {
	try {
		const response = await axios.get<{ name?: string }>(
			`${TRAKT_BASE_URL}/people/${personSlug}`,
			{ headers }
		);
		return response.data.name || null;
	} catch {
		return null;
	}
};

const sortNewestFirst = (items: MediaItem[]) =>
	[...items].sort((a, b) => (b.year || 0) - (a.year || 0));

// Trakt lists a title once per cast role and once per crew department; keep one entry per
// title, with its roles merged into one "Director · Writer · Producer" line.
const mergeCredits = (items: MediaItem[]): MediaItem[] => {
	const byId = new Map<string, { item: MediaItem; characters: string[]; jobs: string[] }>();
	for (const item of items) {
		const id = item.ids.imdb;
		let entry = byId.get(id);
		if (!entry) {
			entry = { item: { ...item }, characters: [], jobs: [] };
			delete entry.item.character;
			delete entry.item.job;
			byId.set(id, entry);
		}
		if (item.creditType === 'cast') entry.item.creditType = 'cast';
		if (item.character && !entry.characters.includes(item.character)) {
			entry.characters.push(item.character);
		}
		const job = item.job ? departmentLabel(item.job) : '';
		if (job && !entry.jobs.includes(job)) entry.jobs.push(job);
	}
	return sortNewestFirst(
		[...byId.values()].map(({ item, characters, jobs }) => ({
			...item,
			...(characters.length ? { character: characters.join(' / ') } : {}),
			...(jobs.length
				? { job: jobs.sort((a, b) => rolePriority(a) - rolePriority(b)).join(' · ') }
				: {}),
		}))
	);
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ message: 'Method Not Allowed' });
	}

	const personSlug = Array.isArray(req.query.personSlug)
		? req.query.personSlug[0]
		: req.query.personSlug;

	if (!personSlug) {
		return res.status(400).json({ message: 'Missing personSlug parameter.' });
	}

	const traktClientId = resolveTraktClientId();

	if (!traktClientId) {
		console.error('Trakt client id missing when requesting person credits');
		return res.status(500).json({ message: 'Trakt configuration missing.' });
	}

	console.info('Fetching person credits', { personSlug });

	const headers = {
		'Content-Type': 'application/json',
		'trakt-api-version': '2',
		'trakt-api-key': traktClientId,
	};

	try {
		const [movieResponse, showResponse, name] = await Promise.all([
			axios.get<TraktMovieCreditsResponse>(`${TRAKT_BASE_URL}/people/${personSlug}/movies`, {
				headers,
			}),
			axios.get<TraktShowCreditsResponse>(`${TRAKT_BASE_URL}/people/${personSlug}/shows`, {
				headers,
			}),
			fetchPersonName(personSlug, headers),
		]);

		const movieCastCredits: MediaItem[] = (movieResponse.data.cast || [])
			.filter((credit) => credit.movie.ids.imdb)
			.map((credit) => ({
				title: credit.movie.title,
				year: credit.movie.year,
				character: credit.character,
				mediaType: 'movie' as const,
				creditType: 'cast' as const,
				ids: {
					imdb: credit.movie.ids.imdb,
				},
			}));

		const movieCrewCredits: MediaItem[] = Object.entries(movieResponse.data.crew || {}).flatMap(
			([job, credits]) =>
				credits
					.filter((credit: any) => credit.movie?.ids?.imdb)
					.map((credit: any) => ({
						title: credit.movie.title,
						year: credit.movie.year,
						job,
						mediaType: 'movie' as const,
						creditType: 'crew' as const,
						ids: {
							imdb: credit.movie.ids.imdb,
						},
					}))
		);

		const showCastCredits: MediaItem[] = (showResponse.data.cast || [])
			.filter((credit) => credit.show.ids.imdb)
			.map((credit) => ({
				title: credit.show.title,
				year: credit.show.year,
				character: credit.character,
				mediaType: 'show' as const,
				creditType: 'cast' as const,
				ids: {
					imdb: credit.show.ids.imdb,
				},
			}));

		const showCrewCredits: MediaItem[] = Object.entries(showResponse.data.crew || {}).flatMap(
			([job, credits]) =>
				credits
					.filter((credit: any) => credit.show?.ids?.imdb)
					.map((credit: any) => ({
						title: credit.show.title,
						year: credit.show.year,
						job,
						mediaType: 'show' as const,
						creditType: 'crew' as const,
						ids: {
							imdb: credit.show.ids.imdb,
						},
					}))
		);

		const movieCredits = mergeCredits([...movieCastCredits, ...movieCrewCredits]);
		const showCredits = mergeCredits([...showCastCredits, ...showCrewCredits]);
		const allCredits = sortNewestFirst([...movieCredits, ...showCredits]);

		return res.status(200).json({
			name,
			movies: movieCredits,
			shows: showCredits,
			all: allCredits,
		});
	} catch (error: unknown) {
		const status = axios.isAxiosError(error) ? (error.response?.status ?? 500) : 500;
		const message = axios.isAxiosError(error)
			? error.response?.data || error.message
			: error instanceof Error
				? error.message
				: 'Unknown error';

		console.error('Failed to fetch person credits', { personSlug, status, error: message });
		return res.status(status).json({ message: 'Failed to fetch person credits.' });
	}
}
