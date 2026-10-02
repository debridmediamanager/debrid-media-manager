import Poster from '@/components/poster';
import { SimklAuthNotice } from '@/components/SimklAuthNotice';
import { SimklPremiumNotice } from '@/components/SimklPremiumNotice';
import { SimklSourceLink } from '@/components/SimklSourceLink';
import { useSimklAuth } from '@/hooks/auth';
import { useCachedList } from '@/hooks/useCachedList';
import type { SimklList } from '@/services/simkl';
import { SimklError, getSimklList, simklItemHref } from '@/services/simkl';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Toaster } from 'react-hot-toast';

function SimklListPage() {
	const { cacheKey, user, loading, error, hasAuth } = useSimklAuth();
	const router = useRouter();
	const rawId = router.query.id;
	const listId =
		typeof rawId === 'string' && /^[1-9]\d*$/.test(rawId) ? Number(rawId) : Number.NaN;
	const hasListId = Number.isSafeInteger(listId) && listId > 0;
	if (!router.isReady || loading) return <SimklAuthNotice loading />;
	if (!hasListId) {
		return (
			<div className="p-4 text-white">
				Invalid Simkl list ID. <Link href="/simkl/mylists">All lists</Link>
			</div>
		);
	}
	if (!hasAuth || !cacheKey || !user) {
		return (
			<div className="mx-2 my-1 min-h-screen bg-gray-900">
				<Toaster position="bottom-right" />
				<SimklAuthNotice error={error} />
			</div>
		);
	}
	return (
		<SimklListContent
			key={`${user.account.id}:${cacheKey}:${listId}`}
			cacheKey={cacheKey}
			userId={user.account.id}
			listId={listId}
		/>
	);
}

function SimklListContent({
	cacheKey,
	userId,
	listId,
}: {
	cacheKey: string;
	userId: number;
	listId: number;
}) {
	const { data, loading, error } = useCachedList<SimklList>(
		`simkl:list:${userId}:${cacheKey}:${listId}`,
		() => getSimklList(listId)
	);

	const items = error ? [] : (data?.items ?? []);
	// Every DMM media page is keyed by IMDb id, so an item Simkl carries no IMDb
	// id for has nowhere to link. Counting them beats dropping them silently:
	// a list that renders eight of its twenty titles otherwise looks broken.
	const linkable = items
		.map((item) => ({ item, href: simklItemHref(item) }))
		.filter((entry): entry is { item: (typeof items)[number]; href: string } => !!entry.href);
	const withoutImdb = items.length - linkable.length;
	const premiumOnly = error instanceof SimklError && error.isPremiumOnly;
	const unauthorized = error instanceof SimklError && error.isUnauthorized;
	const privateList = error instanceof SimklError && error.code === 'private_list';
	const notFound = error instanceof SimklError && error.status === 404;

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
			<div className="mb-3">
				<SimklSourceLink />
			</div>

			{premiumOnly && <SimklPremiumNotice />}
			{unauthorized && <SimklAuthNotice error={error} />}
			{privateList && (
				<SimklAuthNotice message="This Simkl list is private. Sign in with an account that has access." />
			)}
			{notFound && <div className="p-3 text-white">This Simkl list was not found.</div>}

			{error && !premiumOnly && !unauthorized && !privateList && !notFound && (
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
						{linkable.map(({ item, href }) => {
							const section =
								item.type === 'movie'
									? 'movies'
									: item.type === 'anime'
										? 'anime'
										: 'tv';
							const sourceHref = `https://simkl.com/${section}/${item.ids.simkl_id}/${item.ids.slug ? encodeURIComponent(item.ids.slug) : ''}`;
							return (
								<div key={item.ids.simkl_id} className="flex flex-col gap-1">
									<Link href={href}>
										<Poster imdbId={item.ids.imdb!} title={item.title} />
									</Link>
									<SimklSourceLink href={sourceHref} label="View on Simkl" />
								</div>
							);
						})}
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

export default SimklListPage;
