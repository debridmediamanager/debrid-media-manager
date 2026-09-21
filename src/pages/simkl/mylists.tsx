import { SimklPremiumNotice } from '@/components/SimklPremiumNotice';
import useLocalStorage from '@/hooks/localStorage';
import { useCachedList } from '@/hooks/useCachedList';
import { SimklError, SimklListSummary, getSimklUser, getSimklUserLists } from '@/services/simkl';
import { withAuth } from '@/utils/withAuth';
import { List } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { Toaster } from 'react-hot-toast';

/**
 * The user's Simkl custom lists, one card each.
 *
 * Deliberately not Trakt's `mylists` shape, which loads every list's items up
 * front so it can fill a dropdown. A Simkl list holds up to 10,000 items and
 * every page of every list is metered against the signed-in user's own daily
 * allowance, so the items are fetched only once a list is opened.
 */
function SimklMyLists() {
	const [token] = useLocalStorage<string>('simkl:accessToken');
	const [userId] = useLocalStorage<number>('simkl:userId');

	// `simkl:userId` is written by the profile fetch on the home page, which
	// this route does not mount. Resolving it here as well is what makes the
	// page work when it is opened cold - a bookmark, a shared link, a reload.
	const { data, loading, error } = useCachedList<SimklListSummary[]>(
		token ? `simkl:mylists:${userId ?? 'self'}` : null,
		async () => {
			const id = userId ?? (await getSimklUser(token!)).account.id;
			return getSimklUserLists(token!, id);
		}
	);

	const lists = data ?? [];
	const premiumOnly = error instanceof SimklError && error.isPremiumOnly;

	return (
		<div className="mx-2 my-1 min-h-screen bg-gray-900">
			<Head>
				<title>Debrid Media Manager - Simkl - custom lists</title>
			</Head>
			<Toaster position="bottom-right" />

			<div className="mb-4 flex items-center justify-between">
				<h1 className="text-xl font-bold text-white">
					Simkl - <List className="mr-1 inline-block h-5 w-5 text-green-400" /> custom
					lists
				</h1>
				<Link
					href="/"
					className="rounded border-2 border-cyan-500 bg-cyan-900/30 px-2 py-1 text-sm text-cyan-100 transition-colors hover:bg-cyan-800/50"
				>
					Go Home
				</Link>
			</div>

			{premiumOnly && <SimklPremiumNotice />}

			{error && !premiumOnly && (
				<div className="rounded border-2 border-red-500 bg-red-900/30 p-3 text-sm text-red-100">
					Simkl did not return your lists: {error.message}
				</div>
			)}

			{!error && lists.length > 0 && (
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{lists.map((list) => (
						<Link
							key={list.id}
							href={`/simkl/list/${list.id}`}
							className="haptic rounded border-2 border-indigo-500 bg-indigo-900/30 p-3 text-indigo-100 transition-colors hover:bg-indigo-800/50"
						>
							<span className="block font-medium">{list.name}</span>
							<span className="mt-1 block text-xs text-indigo-200/70">
								{list.counts?.items ?? 0} items
								{list.media_type ? ` · ${list.media_type}` : ''}
								{list.privacy ? ` · ${list.privacy}` : ''}
							</span>
						</Link>
					))}
				</div>
			)}

			{!loading && !error && lists.length === 0 && (
				<div className="text-center text-white">
					No custom lists on this account yet. They are created on simkl.com.
				</div>
			)}

			{loading && (
				<div className="mt-4 flex items-center justify-center">
					<div className="h-10 w-10 animate-spin rounded-full border-b-2 border-t-2 border-blue-500"></div>
				</div>
			)}
		</div>
	);
}

export default withAuth(SimklMyLists);
