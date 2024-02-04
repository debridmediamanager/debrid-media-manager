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
import { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';

function TraktMyLists() {
	const [traktToken] = useLocalStorage<string>('trakt:accessToken');
	const [traktUserSlug] = useLocalStorage<string>('trakt:userSlug');
	const [arrayOfResults, setArrayOfResults] = useState<Record<string, TraktMediaItem[]>>({});
	const [loading, setLoading] = useState(2);

	useEffect(() => {
		if (!traktToken || !traktUserSlug) {
			return;
		}
		(async () => {
			const response = await getUsersPersonalLists(traktToken, traktUserSlug);
			for (const list of response) {
				const listName = list.name;
				const items = await fetchListItems(traktToken, traktUserSlug, list.ids.trakt);
				setArrayOfResults((prev) => ({
					...prev,
					[listName]: items,
				}));
			}
			setLoading((prev) => prev - 1);
		})();
		(async () => {
			const response = await getLikedLists(traktToken, traktUserSlug);
			for (const listContainer of response) {
				const list = listContainer.list;
				const listName = list.name;
				const items = await fetchListItems(traktToken, list.user.ids.slug, list.ids.trakt);
				setArrayOfResults((prev) => ({
					...prev,
					[listName]: items,
				}));
			}
			setLoading((prev) => prev - 1);
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<div className="mx-2 my-1 max-w-full">
			<Head>
				<title>Debrid Media Manager - Trakt - {traktUserSlug}&apos;s lists</title>
			</Head>
			<Toaster position="bottom-right" />
			<div className="flex justify-between items-center mb-2">
				<h1 className="text-xl font-bold">Trakt - 🧏🏻‍♀️ {traktUserSlug}&apos;s lists</h1>
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
						<h2 className="mt-4 text-2xl font-bold">
							<span className="text-yellow-500">{idx + 1}</span> {listName}
						</h2>
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
								return (
									<Link
										key={imdbid}
										href={`/${mediaType}/${imdbid}`}
										className=""
									>
										<Poster imdbId={imdbid} />
									</Link>
								);
							})}
						</div>
					</div>
				))}
			{loading !== 0 && (
				<div className="flex justify-center items-center mt-4">
					<div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
				</div>
			)}
		</div>
	);
}

export default withAuth(TraktMyLists);
