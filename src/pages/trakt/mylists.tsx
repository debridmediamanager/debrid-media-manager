import Poster from '@/components/poster';
import useLocalStorage from '@/hooks/localStorage';
import { useCachedList } from '@/hooks/useCachedList';
import {
	TraktMediaItem,
	fetchListItems,
	getLikedLists,
	getUsersPersonalLists,
} from '@/services/trakt';
import { withAuth } from '@/utils/withAuth';
import { List } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import { Toaster } from 'react-hot-toast';

function TraktMyLists() {
	const [traktToken] = useLocalStorage<string>('trakt:accessToken');
	const [traktUserSlug] = useLocalStorage<string>('trakt:userSlug');
	const [selectedList, setSelectedList] = useState<string>('');

	const { data, loading } = useCachedList<Record<string, TraktMediaItem[]>>(
		traktToken && traktUserSlug ? `trakt:mylists:${traktUserSlug}` : null,
		async () => {
			const [personalLists, likedLists] = await Promise.all([
				getUsersPersonalLists(traktToken!, traktUserSlug!),
				getLikedLists(traktToken!, traktUserSlug!),
			]);

			const personalEntries = await Promise.all(
				personalLists.map(async (list) => {
					const items = await fetchListItems(traktToken!, traktUserSlug!, list.ids.trakt);
					return [list.name, items] as const;
				})
			);

			const likedEntries = await Promise.all(
				likedLists.map(async (listContainer) => {
					const list = listContainer.list;
					const items = await fetchListItems(
						traktToken!,
						list.user.ids.slug,
						list.ids.trakt
					);
					return [list.name, items] as const;
				})
			);

			return Object.fromEntries([...personalEntries, ...likedEntries]);
		}
	);

	const arrayOfResults = data ?? {};

	return (
		<div className="mx-2 my-1 min-h-screen bg-gray-900">
			<Head>
				<title>Debrid Media Manager - Trakt - {traktUserSlug}&apos;s lists</title>
			</Head>
			<Toaster position="bottom-right" />

			<div className="mb-4 flex items-center justify-between">
				<h1 className="text-xl font-bold text-white">
					Trakt - <List className="mr-1 inline-block h-5 w-5 text-green-400" />{' '}
					{traktUserSlug}&apos;s lists
				</h1>
				<Link
					href="/"
					className="rounded border-2 border-cyan-500 bg-cyan-900/30 px-2 py-1 text-sm text-cyan-100 transition-colors hover:bg-cyan-800/50"
				>
					Go Home
				</Link>
			</div>

			<div className="mb-6">
				<select
					value={selectedList}
					onChange={(e) => setSelectedList(e.target.value)}
					className="w-full rounded bg-gray-800 p-2 text-white"
				>
					<option value="">Select a list</option>
					{Object.keys(arrayOfResults)
						.sort()
						.map((listName) => (
							<option key={listName} value={listName}>
								{listName}
							</option>
						))}
				</select>
			</div>

			<div className="flex w-full max-w-7xl flex-col items-center gap-6">
				{selectedList && arrayOfResults[selectedList] && (
					<div className="w-full">
						<h2 className="mb-4 text-xl font-bold text-white">{selectedList}</h2>
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
							{arrayOfResults[selectedList].map((item: TraktMediaItem) => {
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
				)}

				{!selectedList && !loading && (
					<div className="text-center text-white">
						Please select a list to view its contents
					</div>
				)}

				{loading && Object.keys(arrayOfResults).length === 0 && (
					<div className="mt-4 flex items-center justify-center">
						<div className="h-10 w-10 animate-spin rounded-full border-b-2 border-t-2 border-blue-500"></div>
					</div>
				)}
			</div>
		</div>
	);
}

export default withAuth(TraktMyLists);
