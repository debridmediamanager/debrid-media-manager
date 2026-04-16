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
	ids: {
		imdb: string;
	};
};

const buildDestination = (imdbId: string, mediaType: 'movie' | 'show') =>
	mediaType === 'show' ? `/show/${imdbId}/1` : `/movie/${imdbId}`;

export default function RelatedShowsPage() {
	const router = useRouter();
	const imdbIdParam = useMemo(() => {
		const raw = router.query.imdbid;
		if (typeof raw !== 'string') {
			return null;
		}
		const trimmed = raw.trim();
		return trimmed.length > 0 ? trimmed : null;
	}, [router.query.imdbid]);

	const {
		data,
		loading: isLoading,
		error,
	} = useCachedList<{
		results: MediaItem[];
		message?: string;
	}>(router.isReady && imdbIdParam ? `related:show:${imdbIdParam}` : null, async () => {
		console.info('Fetching related shows', { imdbId: imdbIdParam });
		const response = await axios.get<{ results: MediaItem[]; message?: string }>(
			`/api/related/show`,
			{ params: { imdbId: imdbIdParam } }
		);
		return response.data;
	});

	const relatedMedia = data?.results ?? [];
	const statusMessage = error ? 'Failed to load related shows.' : (data?.message ?? null);

	const handleNavigate = (event: MouseEvent<HTMLButtonElement>, imdbId: string) => {
		const normalizedImdbId = imdbId.trim();
		if (!normalizedImdbId) {
			console.warn('Ignoring navigation request because IMDb id is missing');
			return;
		}
		const destination = buildDestination(normalizedImdbId, 'show');
		if (event.metaKey || event.ctrlKey) {
			window.open(destination, '_blank');
			return;
		}
		void router.push(destination);
	};

	const backLinkClasses =
		'inline-flex items-center rounded border-2 border-indigo-500 bg-indigo-900/30 px-3 py-1 text-sm text-indigo-100 transition-colors hover:bg-indigo-800/50';

	return (
		<div className="min-h-screen bg-gray-900 text-gray-100">
			<Head>
				<title>Related Shows • {imdbIdParam}</title>
			</Head>
			<main className="mx-auto max-w-6xl px-4 py-8">
				<div className="mb-6 flex flex-wrap items-end justify-between gap-3">
					<div>
						<h1 className="text-2xl font-bold">Related Shows</h1>
						<p className="text-sm text-gray-400">Based on IMDb ID {imdbIdParam}</p>
					</div>
					{imdbIdParam ? (
						<Link
							href={buildDestination(imdbIdParam, 'show')}
							className={backLinkClasses}
						>
							Back to Show
						</Link>
					) : (
						<span
							aria-disabled="true"
							className={`${backLinkClasses} pointer-events-none opacity-60`}
						>
							Back to Show
						</span>
					)}
				</div>

				{statusMessage && (
					<div className="mb-4 rounded border border-yellow-500 bg-yellow-900/30 px-4 py-2 text-sm text-yellow-100">
						{statusMessage}
					</div>
				)}

				{isLoading ? (
					<div>Loading related titles…</div>
				) : relatedMedia.length === 0 ? (
					<div>No related shows found.</div>
				) : (
					<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
						{relatedMedia.map((item) => {
							const normalizedImdbId = item.ids?.imdb?.trim();
							if (!normalizedImdbId) {
								console.warn('Skipping related item without IMDb id', { item });
								return null;
							}
							return (
								<button
									key={normalizedImdbId}
									onClick={(event) => handleNavigate(event, normalizedImdbId)}
									type="button"
									className="cursor-pointer rounded bg-gray-800/40 p-2 text-left transition-transform hover:scale-105 hover:bg-gray-800/70"
								>
									<div className="mx-auto flex w-full max-w-[200px] flex-col items-center">
										<Poster imdbId={normalizedImdbId} title={item.title} />
										<div className="mt-2 w-full text-center">
											<div className="text-sm font-semibold text-gray-100">
												{item.title}
											</div>
											<div className="text-xs text-gray-400">{item.year}</div>
										</div>
									</div>
								</button>
							);
						})}
					</div>
				)}
			</main>
		</div>
	);
}
