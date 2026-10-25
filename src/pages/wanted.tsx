import { sponsorHeaders, useSponsor } from '@/hooks/useSponsor';
import type { WantedItemResponse } from '@/pages/api/wanted';
import type { WantedImportResponse } from '@/pages/api/wanted/import';
import { toasterPosition } from '@/utils/toastOptions';
import { deflatedZipMember } from '@/utils/zipEntry';
import { BookmarkCheck, Home, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast, Toaster } from 'react-hot-toast';

const when = (iso: string) => new Date(iso).toLocaleString();

function seasonsLabel(item: WantedItemResponse): string {
	if (item.kind === 'movie') return 'Film';
	if (item.seasons === null) return 'Every season, new ones too';
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

	const load = useCallback(async () => {
		setError('');
		try {
			const res = await fetch('/api/wanted', { headers: sponsorHeaders() });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || res.statusText);
			setItems(data.items);
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

	const lastPolled = items
		?.map((i) => i.lastPolledAt)
		.filter((d): d is string => !!d)
		.sort()
		.at(-1);

	return (
		<div className="flex min-h-screen flex-col items-center bg-gray-900 p-4">
			<Head>
				<title>Debrid Media Manager - Wanted</title>
			</Head>
			<Toaster position={toasterPosition()} />

			<div className="w-full max-w-3xl">
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
						<div className="mb-3 rounded border border-gray-700 bg-gray-800/60 p-3 text-xs text-gray-300">
							{lastPolled ? (
								<>Your zurg last read this list {when(lastPolled)}.</>
							) : (
								<>
									Your zurg has not read this list yet. Put your DMM API key in
									zurg&apos;s <code>config.yml</code> as <code>dmm_api_key</code>{' '}
									and it reads the list about once a minute.
								</>
							)}
						</div>

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
						<ul className="space-y-2">
							{items?.map((item) => (
								<li
									key={item.id}
									className="flex items-center justify-between rounded border border-gray-700 bg-gray-800/40 p-3"
								>
									<div className="min-w-0">
										<Link
											href={
												item.kind === 'movie'
													? `/movie/${item.imdbId}`
													: `/show/${item.imdbId}/${item.seasons?.[0] ?? 1}`
											}
											className="block truncate text-sm text-white hover:underline"
										>
											{item.title}
										</Link>
										<span className="text-xs text-gray-400">
											{seasonsLabel(item)} ·{' '}
											{item.fulfilledAt
												? `zurg fetched it ${when(item.fulfilledAt)}`
												: `wanted since ${when(item.createdAt)}`}
										</span>
									</div>
									<button
										onClick={() => remove(item)}
										disabled={busy === item.imdbId}
										className="haptic-sm ml-3 rounded border-2 border-red-600 bg-red-900/30 p-2 text-red-100 transition-colors hover:bg-red-800/50 disabled:opacity-50"
										title="Remove from your wanted list"
										aria-label={`Remove ${item.title}`}
									>
										<Trash2 className="h-4 w-4" />
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
