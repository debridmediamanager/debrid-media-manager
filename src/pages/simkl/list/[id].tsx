import Poster from '@/components/poster';
import { SimklPremiumNotice } from '@/components/SimklPremiumNotice';
import useLocalStorage from '@/hooks/localStorage';
import { useCachedList } from '@/hooks/useCachedList';
import { SimklError, SimklList, getSimklList, simklItemHref } from '@/services/simkl';
import { withAuth } from '@/utils/withAuth';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Toaster } from 'react-hot-toast';

function SimklListPage() {
	const [token] = useLocalStorage<string>('simkl:accessToken');
	const router = useRouter();
	const listId = Number(typeof router.query.id === 'string' ? router.query.id : Number.NaN);
	const hasListId = Number.isInteger(listId) && listId > 0;

	const { data, loading, error } = useCachedList<SimklList>(
		token && hasListId ? `simkl:list:${listId}` : null,
		() => getSimklList(token!, listId)
	);

	const items = data?.items ?? [];
	// Every DMM media page is keyed by IMDb id, so an item Simkl carries no IMDb
	// id for has nowhere to link. Counting them beats dropping them silently:
	// a list that renders eight of its twenty titles otherwise looks broken.
	const linkable = items
		.map((item) => ({ item, href: simklItemHref(item) }))
		.filter((entry): entry is { item: (typeof items)[number]; href: string } => !!entry.href);
	const withoutImdb = items.length - linkable.length;
	const premiumOnly = error instanceof SimklError && error.isPremiumOnly;

	return (
		<div className="mx-2 my-1 min-h-screen bg-gray-900">
			<Head>
				<title>Debrid Media Manager - Simkl - {data?.name ?? 'list'}</title>
			</Head>
			<Toaster position="bottom-right" />

			<div className="mb-2 flex items-center justify-between">
				<h1 className="text-xl font-bold text-white">Simkl - {data?.name ?? 'list'}</h1>
				<Link
					href="/simkl/mylists"
					className="rounded border-2 border-cyan-500 bg-cyan-900/30 px-2 py-1 text-sm text-cyan-100 transition-colors hover:bg-cyan-800/50"
				>
					All lists
				</Link>
			</div>

			{premiumOnly && <SimklPremiumNotice />}

			{error && !premiumOnly && (
				<div className="rounded border-2 border-red-500 bg-red-900/30 p-3 text-sm text-red-100">
					Simkl did not return this list: {error.message}
				</div>
			)}

			{withoutImdb > 0 && (
				<p className="mb-2 text-xs text-gray-400">
					{withoutImdb} of {items.length} titles have no IMDb id on Simkl and cannot be
					opened here.
				</p>
			)}

			<div className="flex w-full max-w-7xl flex-col items-center gap-6">
				{linkable.length > 0 && (
					<div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
						{linkable.map(({ item, href }) => (
							<Link key={item.ids.simkl_id} href={href}>
								<Poster imdbId={item.ids.imdb!} title={item.title} />
							</Link>
						))}
					</div>
				)}

				{!loading && !error && items.length === 0 && (
					<div className="text-center text-white">This list is empty.</div>
				)}

				{loading && (
					<div className="mt-4 flex items-center justify-center">
						<div className="h-10 w-10 animate-spin rounded-full border-b-2 border-t-2 border-blue-500"></div>
					</div>
				)}
			</div>
		</div>
	);
}

export default withAuth(SimklListPage);
