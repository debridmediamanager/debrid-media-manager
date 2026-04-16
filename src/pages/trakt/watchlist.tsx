import Poster from '@/components/poster';
import useLocalStorage from '@/hooks/localStorage';
import { useCachedList } from '@/hooks/useCachedList';
import { TraktWatchlistItem, getWatchlistMovies, getWatchlistShows } from '@/services/trakt';
import { withAuth } from '@/utils/withAuth';
import { Eye } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { Toaster } from 'react-hot-toast';

function TraktWatchlist() {
	const [traktToken] = useLocalStorage<string>('trakt:accessToken');
	const [traktUserSlug] = useLocalStorage<string>('trakt:userSlug');

	const { data, loading } = useCachedList<TraktWatchlistItem[]>(
		traktToken && traktUserSlug ? `trakt:watchlist:${traktUserSlug}` : null,
		async () => {
			const movies = await getWatchlistMovies(traktToken!);
			const shows = await getWatchlistShows(traktToken!);
			return [...movies, ...shows].sort((a, b) => a.rank - b.rank);
		}
	);

	const watchlistItems = data ?? [];

	return (
		<div className="mx-2 my-1 min-h-screen bg-gray-900">
			<Head>
				<title>Debrid Media Manager - Trakt - {traktUserSlug}&apos;s Watchlist</title>
			</Head>
			<Toaster position="bottom-right" />

			<div className="mb-2 flex items-center justify-between">
				<h1 className="text-xl font-bold text-white">
					Trakt - <Eye className="mr-1 inline-block h-5 w-5 text-purple-400" />{' '}
					{traktUserSlug}&apos;s Watchlist
				</h1>
				<Link
					href="/"
					className="rounded border-2 border-cyan-500 bg-cyan-900/30 px-2 py-1 text-sm text-cyan-100 transition-colors hover:bg-cyan-800/50"
				>
					Go Home
				</Link>
			</div>

			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
				{watchlistItems.map((item: TraktWatchlistItem) => {
					const imdbid = item.movie?.ids?.imdb || item.show?.ids?.imdb;
					if (!imdbid) {
						return null;
					}
					const mediaType = item.type;
					const title = item.movie?.title || item.show?.title || '';
					return (
						<Link key={imdbid} href={`/${mediaType}/${imdbid}`} className="">
							<Poster imdbId={imdbid} title={title} />
						</Link>
					);
				})}
			</div>

			{loading && (
				<div className="mt-4 flex items-center justify-center">
					<div className="h-10 w-10 animate-spin rounded-full border-b-2 border-t-2 border-blue-500"></div>
				</div>
			)}
		</div>
	);
}

export default withAuth(TraktWatchlist);
