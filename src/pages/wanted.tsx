import { followList, followSummary } from '@/components/FollowListButton';
import Poster from '@/components/poster';
import { sponsorHeaders, useSponsor } from '@/hooks/useSponsor';
import type { WantedItemResponse } from '@/pages/api/wanted';
import type { WantedImportResponse } from '@/pages/api/wanted/import';
import type { WantedListResponse } from '@/pages/api/wanted/lists';
import { shortDate, timeAgo } from '@/utils/timeAgo';
import { toasterPosition } from '@/utils/toastOptions';
import { deflatedZipMember } from '@/utils/zipEntry';
import {
	BookmarkCheck,
	Film,
	Home,
	ListPlus,
	Loader2,
	RefreshCw,
	Search,
	Trash2,
	Tv,
	Upload,
} from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast, Toaster } from 'react-hot-toast';

const when = (iso: string) => new Date(iso).toLocaleString();

const STATUSES = {
	all: ['All', () => true],
	waiting: ['Not fetched yet', (i) => !i.fulfilledAt],
	fetched: ['Fetched', (i) => !!i.fulfilledAt],
	upgrade: ['Waiting for an upgrade', (i) => !!i.fulfilled?.upgradeTo],
} satisfies Record<string, [string, (i: WantedItemResponse) => boolean]>;

// ISO dates sort as strings; never-fetched titles go last.
const SORTS = {
	added: ['Recently added', (a, b) => b.createdAt.localeCompare(a.createdAt)],
	oldest: ['Oldest first', (a, b) => a.createdAt.localeCompare(b.createdAt)],
	title: ['Title', (a, b) => a.title.localeCompare(b.title)],
	fetched: [
		'Recently fetched',
		(a, b) => (b.fulfilledAt ?? '').localeCompare(a.fulfilledAt ?? ''),
	],
} satisfies Record<string, [string, (a: WantedItemResponse, b: WantedItemResponse) => number]>;

function seasonsLabel(item: WantedItemResponse): string {
	if (item.seasons === null) return 'All seasons';
	return `Season${item.seasons.length > 1 ? 's' : ''} ${item.seasons.join(', ')}`;
}

function importSummary(r: WantedImportResponse): string {
	const app = r.app === 'radarr' ? 'Radarr' : 'Sonarr';
	const parts = [
		`${app} is searching for ${r.found.toLocaleString()} title${r.found === 1 ? '' : 's'}: ${r.added.toLocaleString()} added`,
	];
	if (r.alreadyWanted) parts.push(`${r.alreadyWanted.toLocaleString()} already wanted`);
	if (r.overCap) parts.push(`${r.overCap.toLocaleString()} did not fit, the list is full`);
	let text = parts.join(', ') + '.';
	if (r.noImdbId) text += ` ${r.noImdbId.toLocaleString()} left out for having no IMDb id.`;
	if (r.notAvailable)
		text += ` ${r.notAvailable.toLocaleString()} not released yet, which Radarr would not search either.`;
	const lacking = r.seasonsTmdbLacks ?? [];
	if (lacking.length) {
		const seasons = lacking.reduce((n, show) => n + show.seasons.length, 0);
		text += ` ${seasons.toLocaleString()} season${seasons === 1 ? '' : 's'} of ${lacking.map((show) => show.title).join(', ')} will not be fetched: TMDB, which this list follows, numbers them differently from Sonarr. Pick their seasons on their DMM pages instead.`;
	}
	return text;
}

/**
 * A sponsor's wanted list. Their zurg reads it from `/api/sponsor/wanted` and
 * fetches each title, so this page is the list and what zurg made of it: when
 * zurg last read it, and which films it says it fetched.
 */
export default function WantedPage() {
	const { isSponsor } = useSponsor();
	const [items, setItems] = useState<WantedItemResponse[] | null>(null);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState<string | null>(null);
	const [importing, setImporting] = useState(false);
	const [imported, setImported] = useState<string | null>(null);
	const [tab, setTab] = useState<WantedItemResponse['kind']>('movie');
	const [lists, setLists] = useState<WantedListResponse[]>([]);
	const [listUrl, setListUrl] = useState('');
	/** The list being read now: its id, or 'new' for the one being followed. */
	const [following, setFollowing] = useState<string | null>(null);
	const [followed, setFollowed] = useState<string | null>(null);
	const [query, setQuery] = useState('');
	const [status, setStatus] = useState<keyof typeof STATUSES>('all');
	const [sort, setSort] = useState<keyof typeof SORTS>('added');
	const [selected, setSelected] = useState<Set<string>>(new Set());

	const load = useCallback(async () => {
		setError('');
		try {
			const res = await fetch('/api/wanted', { headers: sponsorHeaders() });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || res.statusText);
			setItems(data.items);
			const listsRes = await fetch('/api/wanted/lists', { headers: sponsorHeaders() });
			const listsData = listsRes.ok ? await listsRes.json() : {};
			setLists(Array.isArray(listsData.lists) ? listsData.lists : []);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'unreachable');
		}
	}, []);

	useEffect(() => {
		if (isSponsor) load();
	}, [isSponsor, load]);

	const remove = async (item: WantedItemResponse) => {
		setBusy(item.imdbId);
		try {
			const res = await fetch(`/api/wanted?imdbId=${encodeURIComponent(item.imdbId)}`, {
				method: 'DELETE',
				headers: sponsorHeaders(),
			});
			if (!res.ok) throw new Error((await res.json()).error || res.statusText);
			setItems((prev) => prev?.filter((i) => i.imdbId !== item.imdbId) ?? null);
		} catch (e) {
			toast.error(`Could not remove: ${e instanceof Error ? e.message : 'unreachable'}`);
		} finally {
			setBusy(null);
		}
	};

	const removeMany = async (doomed: WantedItemResponse[]) => {
		if (
			!window.confirm(
				`Remove ${doomed.length} title${doomed.length === 1 ? '' : 's'} from your wanted list? Ones a followed list added will not come back.`
			)
		)
			return;
		const ids = new Set(doomed.map((i) => i.imdbId));
		setBusy('selected');
		try {
			const res = await fetch('/api/wanted', {
				method: 'DELETE',
				headers: { ...sponsorHeaders(), 'Content-Type': 'application/json' },
				body: JSON.stringify({ imdbIds: [...ids] }),
			});
			if (!res.ok) throw new Error((await res.json()).error || res.statusText);
			setItems((prev) => prev?.filter((i) => !ids.has(i.imdbId)) ?? null);
			setSelected(new Set());
		} catch (e) {
			toast.error(`Could not remove: ${e instanceof Error ? e.message : 'unreachable'}`);
		} finally {
			setBusy(null);
		}
	};

	const toggle = (imdbId: string) =>
		setSelected((prev) => {
			const next = new Set(prev);
			if (!next.delete(imdbId)) next.add(imdbId);
			return next;
		});

	// Only the database leaves the browser, still compressed; config.xml holds the arr's API key.
	const importBackup = async (file: File) => {
		setImporting(true);
		setImported(null);
		try {
			const { data } = await deflatedZipMember(file, (name) =>
				/^(radarr|sonarr)\.db$/i.test(name)
			).catch(() => {
				throw new Error('that is not a Radarr or Sonarr backup zip');
			});
			const res = await fetch('/api/wanted/import', {
				method: 'POST',
				headers: { ...sponsorHeaders(), 'Content-Type': 'application/octet-stream' },
				body: data,
			});
			const result = await res.json();
			if (!res.ok) throw new Error(result.error || res.statusText);
			setImported(importSummary(result));
			await load();
		} catch (e) {
			toast.error(`Could not import: ${e instanceof Error ? e.message : 'unreachable'}`);
		} finally {
			setImporting(false);
		}
	};

	// Follow and "Read again" are the same call: the list is read and what is new on it wanted.
	const follow = async (url: string, id = 'new') => {
		setFollowing(id);
		setFollowed(null);
		try {
			setFollowed(followSummary(await followList(url)));
			setListUrl('');
			await load();
		} catch (e) {
			toast.error(`Could not follow: ${e instanceof Error ? e.message : 'unreachable'}`, {
				duration: 8000,
			});
		} finally {
			setFollowing(null);
		}
	};

	const unfollow = async (list: WantedListResponse) => {
		setFollowing(list.id);
		try {
			const res = await fetch(`/api/wanted/lists?id=${encodeURIComponent(list.id)}`, {
				method: 'DELETE',
				headers: sponsorHeaders(),
			});
			if (!res.ok) throw new Error((await res.json()).error || res.statusText);
			setLists((prev) => prev.filter((l) => l.id !== list.id));
		} catch (e) {
			toast.error(`Could not unfollow: ${e instanceof Error ? e.message : 'unreachable'}`);
		} finally {
			setFollowing(null);
		}
	};

	const lastPolled = items
		?.map((i) => i.lastPolledAt)
		.filter((d): d is string => !!d)
		.sort()
		.at(-1);
	const ofKind = items?.filter((i) => i.kind === tab);
	const needle = query.trim().toLowerCase();
	const shown = ofKind
		?.filter((i) => STATUSES[status][1](i) && i.title.toLowerCase().includes(needle))
		.sort(SORTS[sort][1]);
	// Only what is on screen can be removed, so a filter change never removes a title out of sight.
	const picked = shown?.filter((i) => selected.has(i.imdbId)) ?? [];
	const allPicked = !!shown?.length && picked.length === shown.length;

	return (
		<div className="flex min-h-screen flex-col items-center bg-gray-900 p-4">
			<Head>
				<title>Debrid Media Manager - Wanted</title>
			</Head>
			<Toaster position={toasterPosition()} />

			<div className="w-full max-w-6xl">
				<div className="mb-4 flex items-center justify-between">
					<h1 className="flex items-center text-xl font-bold text-white">
						<BookmarkCheck className="mr-2 h-5 w-5 text-rose-400" />
						Wanted
					</h1>
					<div className="flex items-center gap-2">
						{isSponsor && (
							<button
								onClick={load}
								className="haptic-sm rounded border-2 border-indigo-500 bg-indigo-900/30 p-2 text-indigo-100 transition-colors hover:bg-indigo-800/50"
								title="Refresh"
							>
								<RefreshCw className="h-4 w-4" />
							</button>
						)}
						<Link
							href="/"
							className="haptic-sm rounded border-2 border-cyan-500 bg-cyan-900/30 p-2 text-cyan-100 transition-colors hover:bg-cyan-800/50"
							title="Go Home"
						>
							<Home className="h-4 w-4" />
						</Link>
					</div>
				</div>

				<p className="mb-4 text-xs text-gray-400">
					Add films and shows here with the <b className="text-rose-300">Want</b> button
					on their pages, and your zurg fetches them: a cached torrent onto your debrid
					account or an NZB for its Usenet library, whichever its acquisition settings
					prefer. Shows keep getting new episodes as they air. Nothing needs to be
					mounted, and no Sonarr or Radarr.
				</p>

				{!isSponsor ? (
					<div className="rounded border-2 border-rose-700 bg-rose-900/20 p-3 text-sm text-rose-100">
						The wanted list is for sponsors. Paste your DMM API key on the{' '}
						<Link href="/settings" className="underline">
							Settings
						</Link>{' '}
						page to use it.
					</div>
				) : (
					<>
						{/* Only a list zurg never read needs words: zurg is not set up yet. */}
						{lastPolled ? (
							<p className="mb-3 text-xs text-gray-400" title={when(lastPolled)}>
								zurg read it {timeAgo(lastPolled)}
							</p>
						) : (
							items && (
								<div className="mb-3 rounded border border-gray-700 bg-gray-800/60 p-3 text-xs text-gray-300">
									Your zurg has not read this list yet. Put your DMM API key in
									zurg&apos;s <code>config.yml</code> as <code>dmm_api_key</code>{' '}
									and it reads the list about once a minute.
								</div>
							)
						)}

						<div className="mb-3 rounded border border-gray-700 bg-gray-800/60 p-3 text-xs text-gray-300">
							<p className="mb-2">
								Moving from Radarr or Sonarr? Import a backup (System → Backup, or
								the zip in its <code>Backups</code> folder) and everything it is
								still searching for is added: its monitored films without a file,
								and the seasons of its monitored shows with aired episodes missing.
							</p>
							<label className="haptic-sm inline-flex cursor-pointer items-center rounded border-2 border-rose-500 bg-rose-900/30 px-2 py-1 text-rose-100 transition-colors hover:bg-rose-800/50">
								{importing ? (
									<Loader2 className="mr-1 h-4 w-4 animate-spin" />
								) : (
									<Upload className="mr-1 h-4 w-4" />
								)}
								Import a Radarr or Sonarr backup
								<input
									type="file"
									accept=".zip,application/zip"
									className="hidden"
									disabled={importing}
									onChange={(e) => {
										const file = e.target.files?.[0];
										e.target.value = '';
										if (file) importBackup(file);
									}}
								/>
							</label>
							{imported && <p className="mt-2 text-gray-200">{imported}</p>}
						</div>

						<div className="mb-3 rounded border border-gray-700 bg-gray-800/60 p-3 text-xs text-gray-300">
							<p className="mb-2">
								Follow a Trakt or MDBList list and its titles are wanted, new ones
								included: the list is read again every six hours. A title you remove
								here stays removed, and unfollowing keeps what was added. For an
								IMDb or Letterboxd list, make an MDBList list of it first.
							</p>
							<form
								className="flex flex-wrap gap-2"
								onSubmit={(e) => {
									e.preventDefault();
									if (listUrl.trim()) follow(listUrl.trim());
								}}
							>
								<input
									type="url"
									value={listUrl}
									onChange={(e) => setListUrl(e.target.value)}
									placeholder="https://trakt.tv/users/<user>/lists/<list> or https://mdblist.com/lists/<user>/<list>"
									aria-label="List URL"
									disabled={following !== null}
									className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-900 px-2 py-1 text-gray-100 placeholder-gray-500"
								/>
								<button
									type="submit"
									disabled={following !== null || !listUrl.trim()}
									className="haptic-sm inline-flex items-center rounded border-2 border-rose-500 bg-rose-900/30 px-2 py-1 text-rose-100 transition-colors hover:bg-rose-800/50 disabled:cursor-not-allowed disabled:opacity-50"
								>
									{following === 'new' ? (
										<Loader2 className="mr-1 h-4 w-4 animate-spin" />
									) : (
										<ListPlus className="mr-1 h-4 w-4" />
									)}
									Follow
								</button>
							</form>
							{followed && <p className="mt-2 text-gray-200">{followed}</p>}
							{lists.length > 0 && (
								<ul className="mt-3 divide-y divide-gray-700">
									{lists.map((list) => (
										<li
											key={list.id}
											className="flex flex-wrap items-center gap-2 py-2"
										>
											<div className="min-w-0 flex-1">
												<a
													href={list.url}
													target="_blank"
													rel="noreferrer"
													className="block truncate font-medium text-gray-100 hover:underline"
												>
													{list.name}
												</a>
												<span className="text-gray-400">
													{list.count.toLocaleString()} title
													{list.count === 1 ? '' : 's'} ·{' '}
													{list.added.toLocaleString()} added so far ·{' '}
													{list.error ? (
														<span className="text-red-300">
															{list.error}
														</span>
													) : list.syncedAt ? (
														<span title={when(list.syncedAt)}>
															read {timeAgo(list.syncedAt)}
														</span>
													) : (
														'not read yet'
													)}
												</span>
											</div>
											<button
												onClick={() => follow(list.url, list.id)}
												disabled={following !== null}
												className="haptic-sm inline-flex items-center rounded border-2 border-indigo-500 bg-indigo-900/30 px-2 py-1 text-indigo-100 transition-colors hover:bg-indigo-800/50 disabled:opacity-50"
												title="Read the list now"
											>
												{following === list.id ? (
													<Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
												) : (
													<RefreshCw className="mr-1 h-3.5 w-3.5" />
												)}
												Read again
											</button>
											<button
												onClick={() => unfollow(list)}
												disabled={following !== null}
												className="haptic-sm inline-flex items-center rounded border-2 border-red-600 bg-red-900/40 px-2 py-1 text-red-100 transition-colors hover:bg-red-800/60 disabled:opacity-50"
												title="Stop following; what it added stays wanted"
												aria-label={`Unfollow ${list.name}`}
											>
												<Trash2 className="mr-1 h-3.5 w-3.5" />
												Unfollow
											</button>
										</li>
									))}
								</ul>
							)}
						</div>

						{error && (
							<div className="mb-3 rounded border-2 border-red-600 bg-red-900/20 p-3 text-xs text-red-200">
								Could not load your wanted list: {error}
							</div>
						)}

						{items === null && !error && (
							<Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" />
						)}
						{items?.length === 0 && (
							<p className="text-center text-sm text-gray-400">Nothing wanted yet.</p>
						)}
						{!!items?.length && (
							<div className="mb-3 flex gap-2" role="tablist">
								{(
									[
										['movie', 'Movies', Film],
										['show', 'Shows', Tv],
									] as const
								).map(([kind, label, Icon]) => (
									<button
										key={kind}
										role="tab"
										aria-selected={tab === kind}
										onClick={() => setTab(kind)}
										className={`haptic-sm flex items-center rounded border-2 px-3 py-1 text-sm transition-colors ${
											tab === kind
												? 'border-rose-500 bg-rose-900/40 text-rose-100'
												: 'border-gray-600 bg-gray-800/40 text-gray-300 hover:bg-gray-700/50'
										}`}
									>
										<Icon className="mr-1 h-4 w-4" />
										{label} ({items.filter((i) => i.kind === kind).length})
									</button>
								))}
							</div>
						)}
						{!!ofKind?.length && (
							<div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
								<label className="relative min-w-40 flex-1">
									<Search className="pointer-events-none absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-gray-500" />
									<input
										type="search"
										value={query}
										onChange={(e) => setQuery(e.target.value)}
										placeholder="Search titles"
										aria-label="Search titles"
										className="w-full rounded border border-gray-600 bg-gray-900 py-1 pr-2 pl-8 text-gray-100 placeholder-gray-500"
									/>
								</label>
								<select
									value={status}
									onChange={(e) =>
										setStatus(e.target.value as keyof typeof STATUSES)
									}
									aria-label="Show"
									className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-gray-100"
								>
									{Object.entries(STATUSES).map(([key, [label]]) => (
										<option key={key} value={key}>
											{label} (
											{
												ofKind.filter(
													STATUSES[key as keyof typeof STATUSES][1]
												).length
											}
											)
										</option>
									))}
								</select>
								<select
									value={sort}
									onChange={(e) => setSort(e.target.value as keyof typeof SORTS)}
									aria-label="Sort by"
									className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-gray-100"
								>
									{Object.entries(SORTS).map(([key, [label]]) => (
										<option key={key} value={key}>
											{label}
										</option>
									))}
								</select>
							</div>
						)}
						{!!shown?.length && (
							<div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-300">
								<label className="inline-flex cursor-pointer items-center gap-1.5">
									<input
										type="checkbox"
										checked={allPicked}
										onChange={() =>
											setSelected(
												new Set(allPicked ? [] : shown.map((i) => i.imdbId))
											)
										}
										className="h-4 w-4 accent-rose-500"
									/>
									Select all {shown.length.toLocaleString()}
									{shown.length < (ofKind?.length ?? 0) && ' shown'}
								</label>
								{picked.length > 0 && (
									<>
										<button
											onClick={() => removeMany(picked)}
											disabled={busy !== null}
											className="haptic-sm inline-flex items-center rounded border-2 border-red-600 bg-red-900/40 px-2 py-1 text-red-100 transition-colors hover:bg-red-800/60 disabled:opacity-50"
										>
											{busy === 'selected' ? (
												<Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
											) : (
												<Trash2 className="mr-1 h-3.5 w-3.5" />
											)}
											Remove {picked.length.toLocaleString()} selected
										</button>
										<button
											onClick={() => setSelected(new Set())}
											className="text-gray-400 hover:text-gray-200 hover:underline"
										>
											Clear selection
										</button>
									</>
								)}
							</div>
						)}
						{!!items?.length && ofKind?.length === 0 && (
							<p className="text-center text-sm text-gray-400">
								No {tab === 'movie' ? 'films' : 'shows'} wanted.
							</p>
						)}
						{!!ofKind?.length && shown?.length === 0 && (
							<p className="text-center text-sm text-gray-400">Nothing matches.</p>
						)}
						<ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
							{shown?.map((item) => (
								<li key={item.id} className="group relative min-w-0">
									<input
										type="checkbox"
										checked={selected.has(item.imdbId)}
										onChange={() => toggle(item.imdbId)}
										aria-label={`Select ${item.title}`}
										className="absolute top-1.5 left-1.5 z-10 h-4 w-4 cursor-pointer accent-rose-500"
									/>
									<Link
										href={
											item.kind === 'movie'
												? `/movie/${item.imdbId}`
												: `/show/${item.imdbId}/${item.seasons?.[0] ?? 1}`
										}
										className="block"
									>
										<div
											className={
												selected.has(item.imdbId)
													? 'rounded-t ring-2 ring-rose-400'
													: undefined
											}
										>
											<Poster imdbId={item.imdbId} title={item.title} />
										</div>
										{/* Radarr/Sonarr's bar under the poster: green once zurg fetched it. */}
										<div
											className={`h-1 rounded-b ${item.fulfilledAt ? 'bg-green-500' : 'bg-rose-500'}`}
										/>
										<span className="mt-1 block truncate text-xs text-white group-hover:underline">
											{item.title}
										</span>
									</Link>
									<span className="block truncate text-[11px] text-gray-400">
										{item.kind === 'show' && <>{seasonsLabel(item)} · </>}
										<span
											title={[
												when(item.fulfilledAt ?? item.createdAt),
												item.fulfilled?.release,
											]
												.filter(Boolean)
												.join('\n')}
										>
											{item.fulfilledAt
												? `fetched ${shortDate(item.fulfilledAt)}`
												: `since ${shortDate(item.createdAt)}`}
											{item.fulfilled?.upgradeTo &&
												` · waiting for ${item.fulfilled.upgradeTo}`}
										</span>
									</span>
									<button
										onClick={() => remove(item)}
										disabled={busy !== null}
										className="haptic-sm absolute top-1 right-1 rounded border-2 border-red-600 bg-red-900/80 p-1 text-red-100 transition-colors hover:bg-red-800 disabled:opacity-50"
										title="Remove from your wanted list"
										aria-label={`Remove ${item.title}`}
									>
										<Trash2 className="h-3.5 w-3.5" />
									</button>
								</li>
							))}
						</ul>
					</>
				)}
			</div>
		</div>
	);
}
