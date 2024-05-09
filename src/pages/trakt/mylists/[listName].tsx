import Poster from '@/components/poster';
import useLocalStorage from '@/hooks/localStorage';
import {
	TraktMediaItem,
	fetchListItems,
	getLikedLists,
	getUsersPersonalLists,
} from '@/services/trakt';
import { withAuth } from '@/utils/withAuth';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';

function TraktMyLists() {
	const [traktToken] = useLocalStorage<string>('trakt:accessToken');
	const [traktUserSlug] = useLocalStorage<string>('trakt:userSlug');
	const [arrayOfResults, setArrayOfResults] = useState<Record<string, TraktMediaItem[]>>({});
	const [loading, setLoading] = useState(true);

	const router = useRouter();
	const listName = decodeURIComponent(router.query.listName as string);

	useEffect(() => {
		if (!traktToken || !traktUserSlug) {
			return;
		}
		(async () => {
			const response = await getUsersPersonalLists(traktToken, traktUserSlug);
			for (const list of response) {
				if (list.name !== listName) continue;
				const items = await fetchListItems(traktToken, traktUserSlug, list.ids.trakt);
				setArrayOfResults((prev) => ({
					...prev,
					[listName]: items,
				}));
				setLoading(false);
			}
		})();
		(async () => {
			const response = await getLikedLists(traktToken, traktUserSlug);
			for (const listContainer of response) {
				const list = listContainer.list;
				if (list.name !== listName) continue;
				const items = await fetchListItems(traktToken, list.user.ids.slug, list.ids.trakt);
				setArrayOfResults((prev) => ({
					...prev,
					[listName]: items,
				}));
				setLoading(false);
			}
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router.query.listName]);

	return (
		<div className="mx-2 my-1 max-w-full">
			<Head>
				<title>
					Debrid Media Manager - Trakt - {traktUserSlug} - {listName}
				</title>
			</Head>
			<Toaster position="bottom-right" />
			<div className="flex justify-between items-center mb-2">
				<h1 className="text-xl font-bold">
					Trakt - {traktUserSlug} - {listName}
				</h1>
				<Link
					href="/"
					className="text-sm bg-cyan-800 hover:bg-cyan-700 text-white py-1 px-2 rounded"
				>
					Go Home
				</Link>
			</div>
			{Object.keys(arrayOfResults)
				.sort()
				.map((listName: string, idx: number) => (
					<div key={listName}>
						<div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
							{arrayOfResults[listName].map((item: TraktMediaItem) => {
								const imdbid =
									item.movie?.ids?.imdb ||
									item.show?.ids?.imdb ||
									(item as any).ids?.imdb;
								if (!imdbid) {
									return null;
								}
								const mediaType = item.movie ? 'movie' : 'show';
								const title =
									item.movie?.title || item.show?.title || (item as any).title;
								return (
									<Link
										key={imdbid}
										href={`/${mediaType}/${imdbid}`}
										className=""
									>
										<Poster imdbId={imdbid} title={title} />
									</Link>
								);
							})}
						</div>
					</div>
				))}
			{loading && (
				<div className="flex justify-center items-center mt-4">
					<div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
				</div>
			)}
		</div>
	);
}

export default withAuth(TraktMyLists);
