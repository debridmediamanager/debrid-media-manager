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
import Image from 'next/image';
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
		<div className="mx-2 my-1 bg-gray-900 min-h-screen">
			<Head>
				<title>Debrid Media Manager - Trakt - {traktUserSlug}&apos;s lists</title>
			</Head>
			<Toaster position="bottom-right" />

			<div className="flex justify-between items-center mb-2">
				<h1 className="text-xl font-bold text-white">
					Trakt - 🧏🏻‍♀️ {traktUserSlug}&apos;s lists
				</h1>
				<Link
					href="/"
					className="text-sm border-2 border-cyan-500 bg-cyan-900/30 text-cyan-100 hover:bg-cyan-800/50 py-1 px-2 rounded transition-colors"
				>
					Go Home
				</Link>
			</div>

			<div className="flex flex-col items-center w-full max-w-7xl gap-6">
				{Object.keys(arrayOfResults)
					.sort()
					.map((listName: string, idx: number) => (
						<div key={listName} className="w-full">
							<h2 className="text-xl font-bold text-white mb-4">
								<span className="text-yellow-500">{idx + 1}</span> {listName}
							</h2>
							<div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-3">
								{(arrayOfResults[listName].length >= 8
									? arrayOfResults[listName].slice(0, 8)
									: arrayOfResults[listName]
								).map(
									(item: TraktMediaItem, idx: number, arr: TraktMediaItem[]) => {
										// check if end of list
										if (
											arrayOfResults[listName].length >= 8 &&
											idx === arr.length - 1
										) {
											return (
												<Link
													key={listName}
													href={`/trakt/mylists/${listName}`}
													className="flex justify-center items-center bg-gray-800 text-white font-bold rounded"
												>
													<Image
														src={`https://fakeimg.pl/400x600/282828/eae0d0?font_size=40&font=bebas&text=View ${
															arrayOfResults[listName].length - 8
														} more`}
														alt="plus"
														width={400}
														height={600}
													/>
												</Link>
											);
										}
										const imdbid =
											item.movie?.ids?.imdb ||
											item.show?.ids?.imdb ||
											(item as any).ids?.imdb;
										if (!imdbid) {
											return null;
										}
										const mediaType = item.movie ? 'movie' : 'show';
										const title =
											item.movie?.title ||
											item.show?.title ||
											(item as any).title;
										return (
											<Link
												key={imdbid}
												href={`/${mediaType}/${imdbid}`}
												className=""
											>
												<Poster imdbId={imdbid} title={title} />
											</Link>
										);
									}
								)}
							</div>
						</div>
					))}

				{loading !== 0 && (
					<div className="flex justify-center items-center mt-4">
						<div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
					</div>
				)}
			</div>
		</div>
	);
}

export default withAuth(TraktMyLists);
