import { animeTypeLabel } from '@/components/AnimeEntryLinks';
import { useCachedList } from '@/hooks/useCachedList';
import type { AnimeEntryRow } from '@/services/database/anime';
import { withAuth } from '@/utils/withAuth';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useState } from 'react';
import { Toaster } from 'react-hot-toast';

function animeHref(entry: AnimeEntryRow): string | null {
	if (entry.anidb_id) return `/anime/${entry.anidb_id}`;
	return entry.mal_id ? `/anime/mal-${entry.mal_id}` : null;
}

export function AnimeHome() {
	const router = useRouter();
	const [typed, setTyped] = useState('');
	const { data, loading, error } = useCachedList<AnimeEntryRow[]>('anime:recent', async () => {
		const res = await fetch('/api/anime/recent');
		if (!res.ok) throw new Error(`Could not load anime (${res.status})`);
		return ((await res.json()) as { results: AnimeEntryRow[] }).results;
	});
	const entries = data ?? [];

	const search = (event: FormEvent) => {
		event.preventDefault();
		const query = typed.trim();
		if (query) router.push(`/search?query=${encodeURIComponent(query)}`);
	};

	return (
		<div className="mx-2 my-1 max-w-full">
			<Head>
				<title>Debrid Media Manager - Anime</title>
			</Head>
			<Toaster position="bottom-right" />
			<div className="mb-2 flex items-center justify-between">
				<h1 className="text-xl font-bold">Anime</h1>
				<Link
					href="/"
					className="rounded bg-cyan-800 px-2 py-1 text-sm text-white hover:bg-cyan-700"
				>
					Go Home
				</Link>
			</div>
			<form onSubmit={search} className="mb-3 flex gap-2">
				<input
					type="search"
					value={typed}
					onChange={(e) => setTyped(e.target.value)}
					placeholder="Search anime..."
					aria-label="Search anime"
					className="flex-1 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm"
				/>
				<button type="submit" className="rounded bg-cyan-800 px-3 py-1 text-sm">
					Search
				</button>
			</form>
			<div className="mb-4 flex gap-2 text-sm">
				<Link
					href="/browse/genre/anime"
					className="rounded border border-blue-500 bg-blue-900/30 px-2 py-1"
				>
					Popular anime
				</Link>
				<Link
					href="/browse/genre/donghua"
					className="rounded border border-blue-500 bg-blue-900/30 px-2 py-1"
				>
					Donghua
				</Link>
			</div>
			<h2 className="mb-2 text-lg font-semibold">Recently updated</h2>
			{loading && entries.length === 0 && (
				<div className="mt-4 flex items-center justify-center">
					<div className="h-10 w-10 animate-spin rounded-full border-b-2 border-t-2 border-blue-500"></div>
				</div>
			)}
			{error && (
				<div className="relative mt-4 rounded border border-red-400 bg-red-900 px-4 py-3">
					<strong className="font-bold">Error:</strong>
					<span className="block sm:inline"> {error.message}</span>
				</div>
			)}
			{entries.length > 0 && (
				<div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
					{entries.map((entry) => {
						const href = animeHref(entry);
						if (!href) return null;
						const type = animeTypeLabel(entry.type);
						return (
							<Link key={href} href={href} className="block">
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img
									src={entry.poster_url}
									alt={entry.title}
									loading="lazy"
									className="aspect-[2/3] w-full rounded object-cover"
								/>
								<div className="mt-1 line-clamp-2 text-xs">{entry.title}</div>
								{type && <div className="text-[10px] text-gray-400">{type}</div>}
							</Link>
						);
					})}
				</div>
			)}
		</div>
	);
}

export default withAuth(AnimeHome);
