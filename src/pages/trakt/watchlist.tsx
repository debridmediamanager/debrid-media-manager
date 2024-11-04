import Poster from '@/components/poster';
import useLocalStorage from '@/hooks/localStorage';
import { TraktWatchlistItem, getWatchlistMovies, getWatchlistShows } from '@/services/trakt';
import { withAuth } from '@/utils/withAuth';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';

function TraktWatchlist() {
	const [traktToken] = useLocalStorage<string>('trakt:accessToken');
	const [traktUserSlug] = useLocalStorage<string>('trakt:userSlug');
	const [watchlistItems, setWatchlistItems] = useState<TraktWatchlistItem[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (!traktToken || !traktUserSlug) {
			return;
		}
		(async () => {
			try {
				const movies = await getWatchlistMovies(traktToken);
				const shows = await getWatchlistShows(traktToken);
				const combinedWatchlist = [...movies, ...shows].sort((a, b) => a.rank - b.rank);
				setWatchlistItems(combinedWatchlist);
			} catch (error) {
				console.error('Error fetching watchlist:', error);
			} finally {
				setLoading(false);
			}
		})();
	}, [traktToken, traktUserSlug]);

	return (
		<div className="mx-2 my-1 bg-gray-900 min-h-screen">
			<Head>
				<title>Debrid Media Manager - Trakt - {traktUserSlug}&apos;s Watchlist</title>
			</Head>
			<Toaster position="bottom-right" />

			<div className="flex justify-between items-center mb-2">
				<h1 className="text-xl font-bold text-white">
					Trakt - 👀 {traktUserSlug}&apos;s Watchlist
				</h1>
				<Link
					href="/"
					className="text-sm border-2 border-cyan-500 bg-cyan-900/30 text-cyan-100 hover:bg-cyan-800/50 py-1 px-2 rounded transition-colors"
				>
					Go Home
				</Link>
			</div>

			<div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-3">
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
				<div className="flex justify-center items-center mt-4">
					<div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
				</div>
			)}
		</div>
	);
}

export default withAuth(TraktWatchlist);
