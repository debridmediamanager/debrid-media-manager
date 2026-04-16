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

type PersonCreditsResponse = {
	movies: MediaItem[];
	shows: MediaItem[];
	all: MediaItem[];
};

export default function PersonMoviesPage() {
	const router = useRouter();
	const personSlug = useMemo(() => {
		const raw = router.query.personSlug;
		return typeof raw === 'string' ? raw : '';
	}, [router.query.personSlug]);

	const {
		data,
		loading: isLoading,
		error,
	} = useCachedList<MediaItem[]>(
		router.isReady && personSlug ? `person:${personSlug}:movies` : null,
		async () => {
			console.info('Fetching person movie credits', { personSlug });
			const response = await axios.get<PersonCreditsResponse>(`/api/person/${personSlug}`);
			return response.data.movies;
		}
	);

	const movies = data ?? [];
	const statusMessage = error ? 'Failed to load movie credits.' : null;

	const handleNavigate = (event: MouseEvent<HTMLButtonElement>, imdbId: string) => {
		const destination = `/movie/${imdbId}`;
		if (event.metaKey || event.ctrlKey) {
			window.open(destination, '_blank');
			return;
		}
		void router.push(destination);
	};

	const personName = personSlug
		.split('-')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');

	return (
		<div className="min-h-screen bg-gray-900 text-gray-100">
			<Head>
				<title>{personName} • Movies</title>
			</Head>
			<main className="mx-auto max-w-6xl px-4 py-8">
				<div className="mb-6">
					<h1 className="text-2xl font-bold">{personName}</h1>
					<p className="text-sm text-gray-400">Movies</p>
				</div>

				<div className="mb-4 flex gap-2">
					<Link
						href={`/person/${personSlug}/movies`}
						className="rounded bg-indigo-600 px-4 py-2 text-sm text-white"
					>
						Movies ({movies.length})
					</Link>
					<Link
						href={`/person/${personSlug}/shows`}
						className="rounded bg-gray-800 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-700"
					>
						TV Shows
					</Link>
				</div>

				{statusMessage && (
					<div className="mb-4 rounded border border-yellow-500 bg-yellow-900/30 px-4 py-2 text-sm text-yellow-100">
						{statusMessage}
					</div>
				)}

				{isLoading ? (
					<div>Loading movies…</div>
				) : movies.length === 0 ? (
					<div>No movies found.</div>
				) : (
					<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
						{movies.map((item) => (
							<button
								key={item.ids.imdb}
								onClick={(event) => handleNavigate(event, item.ids.imdb)}
								type="button"
								className="cursor-pointer rounded bg-gray-800/40 p-2 text-left transition-transform hover:scale-105 hover:bg-gray-800/70"
							>
								<div className="mx-auto flex w-full max-w-[200px] flex-col items-center">
									<Poster imdbId={item.ids.imdb} title={item.title} />
									<div className="mt-2 w-full text-center">
										<div className="text-sm font-semibold text-gray-100">
											{item.title}
										</div>
										<div className="text-xs text-gray-400">{item.year}</div>
										{item.character && (
											<div className="text-xs text-gray-500">
												as {item.character}
											</div>
										)}
										{item.job && (
											<div className="text-xs text-gray-500">{item.job}</div>
										)}
									</div>
								</div>
							</button>
						))}
					</div>
				)}
			</main>
		</div>
	);
}
