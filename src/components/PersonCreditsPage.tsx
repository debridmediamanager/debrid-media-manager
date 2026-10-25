import Poster from '@/components/poster';
import { useCachedList } from '@/hooks/useCachedList';
import axios from 'axios';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { MouseEvent, useMemo } from 'react';

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

export type PersonCreditsResponse = {
	name?: string | null;
	movies: MediaItem[];
	shows: MediaItem[];
	all: MediaItem[];
};

const SELF_CHARACTER = /^(self|himself|herself|themselves)\b|archive footage/i;

// A credit that is only an appearance as themselves (interviews, making-ofs, archive footage).
const isSelfAppearance = (item: MediaItem) =>
	!item.job && !!item.character && SELF_CHARACTER.test(item.character);

// "Self - Interviewee" -> "Interviewee", "Self" -> "".
const selfRole = (character: string) =>
	character
		.replace(/^(self|himself|herself|themselves)\s*(-\s*)?/i, '')
		.replace(/^\((.*)\)$/, '$1');

const GRID_CLASSES =
	'grid grid-cols-3 gap-2 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]';

export default function PersonCreditsPage({ tab }: { tab: 'movies' | 'shows' }) {
	const router = useRouter();
	const personSlug = useMemo(() => {
		const raw = router.query.personSlug;
		return typeof raw === 'string' ? raw : '';
	}, [router.query.personSlug]);

	const {
		data,
		loading: isLoading,
		error,
	} = useCachedList<PersonCreditsResponse>(
		router.isReady && personSlug ? `person:${personSlug}` : null,
		async () => {
			console.info('Fetching person credits', { personSlug });
			const response = await axios.get<PersonCreditsResponse>(`/api/person/${personSlug}`);
			return response.data;
		}
	);

	const label = tab === 'movies' ? 'movies' : 'TV shows';
	const credits = data?.[tab] ?? [];
	const credited = credits.filter((item) => !isSelfAppearance(item));
	const selfAppearances = credits.filter(isSelfAppearance);
	const statusMessage = error
		? `Failed to load ${tab === 'movies' ? 'movie' : 'TV show'} credits.`
		: null;

	const handleNavigate = (event: MouseEvent<HTMLButtonElement>, imdbId: string) => {
		const destination = tab === 'movies' ? `/movie/${imdbId}` : `/show/${imdbId}/1`;
		if (event.metaKey || event.ctrlKey) {
			window.open(destination, '_blank');
			return;
		}
		void router.push(destination);
	};

	const personName =
		data?.name ||
		personSlug
			.split('-')
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(' ');

	const tabClass = (active: boolean) =>
		active
			? 'rounded bg-indigo-600 px-4 py-2 text-sm text-white'
			: 'rounded bg-gray-800 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-700';

	const renderCard = (item: MediaItem, role: string) => (
		<button
			key={item.ids.imdb}
			onClick={(event) => handleNavigate(event, item.ids.imdb)}
			type="button"
			className="min-w-0 cursor-pointer rounded bg-gray-800/40 p-1 text-left transition-transform hover:scale-105 hover:bg-gray-800/70 sm:p-2"
		>
			<div className="mx-auto flex w-full max-w-[200px] min-w-0 flex-col items-center">
				<Poster imdbId={item.ids.imdb} title={item.title} />
				<div className="mt-2 w-full text-center">
					<div className="flex flex-wrap items-baseline justify-center gap-x-1">
						<span
							className="line-clamp-2 min-w-0 text-sm font-semibold break-words text-gray-100"
							title={item.title}
						>
							{item.title}
						</span>
						{item.year ? (
							<span className="shrink-0 text-xs text-gray-400">{item.year}</span>
						) : null}
					</div>
					{role && (
						<div className="line-clamp-2 text-xs text-gray-400" title={role}>
							{role}
						</div>
					)}
				</div>
			</div>
		</button>
	);

	const creditRole = (item: MediaItem) =>
		[item.job, item.character && `as ${item.character}`].filter(Boolean).join(' · ');

	return (
		<div className="min-h-screen bg-gray-900 text-gray-100">
			<Head>
				<title>{`${personName} • ${tab === 'movies' ? 'Movies' : 'TV Shows'}`}</title>
			</Head>
			<main className="mx-auto max-w-6xl px-4 py-8">
				<h1 className="mb-4 text-2xl font-bold">{personName}</h1>

				<div className="mb-4 flex gap-2">
					<Link
						href={`/person/${personSlug}/movies`}
						className={tabClass(tab === 'movies')}
					>
						Movies{data ? ` (${data.movies.length})` : ''}
					</Link>
					<Link
						href={`/person/${personSlug}/shows`}
						className={tabClass(tab === 'shows')}
					>
						TV Shows{data ? ` (${data.shows.length})` : ''}
					</Link>
				</div>

				{statusMessage && (
					<div className="mb-4 rounded border border-yellow-500 bg-yellow-900/30 px-4 py-2 text-sm text-yellow-100">
						{statusMessage}
					</div>
				)}

				{isLoading ? (
					<div>Loading {label}…</div>
				) : credits.length === 0 ? (
					<div>No {label} found.</div>
				) : (
					<>
						{credited.length > 0 && (
							<div className={GRID_CLASSES}>
								{credited.map((item) => renderCard(item, creditRole(item)))}
							</div>
						)}
						{selfAppearances.length > 0 && (
							<details
								className={credited.length > 0 ? 'mt-6' : ''}
								open={credited.length === 0}
							>
								<summary className="cursor-pointer text-sm text-gray-300">
									Appearances as themselves ({selfAppearances.length})
								</summary>
								<div className={`mt-3 ${GRID_CLASSES}`}>
									{selfAppearances.map((item) =>
										renderCard(item, selfRole(item.character ?? ''))
									)}
								</div>
							</details>
						)}
					</>
				)}
			</main>
		</div>
	);
}
