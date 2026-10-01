import type { AnimeEntryLink } from '@/services/anime/animeEntries';
import { useEffect, useMemo, useState } from 'react';

export type { AnimeEntryLink };

/** The route's limit; a browse page of four lists asks for 96. */
const BATCH_SIZE = 100;

/**
 * Answers already fetched in this tab, including "no entries" as an empty
 * list, so moving between a show's seasons asks once rather than per season.
 */
const cache = new Map<string, AnimeEntryLink[]>();

async function fetchBatch(imdbIds: string[]): Promise<void> {
	const response = await fetch(`/api/anime/by-imdb?imdbids=${imdbIds.join(',')}`);
	if (!response.ok) throw new Error(`by-imdb answered ${response.status}`);
	const body = (await response.json()) as { results?: Record<string, AnimeEntryLink[]> };
	for (const imdbId of imdbIds) cache.set(imdbId, body.results?.[imdbId] ?? []);
}

/**
 * The AniDB entries filed under each IMDb id, for linking a show, film or
 * poster to its anime pages. Ids with no entry map to an empty list; a failed
 * lookup is left out, so nothing renders rather than a wrong "none".
 */
export function useAnimeEntries(imdbIds: readonly string[]): Record<string, AnimeEntryLink[]> {
	const key = useMemo(
		() => [...new Set(imdbIds.filter((id) => /^tt\d+$/.test(id)))].sort().join(','),
		[imdbIds]
	);
	const [version, setVersion] = useState(0);

	useEffect(() => {
		if (!key) return;
		const missing = key.split(',').filter((id) => !cache.has(id));
		if (missing.length === 0) return;
		let cancelled = false;
		const batches: string[][] = [];
		for (let i = 0; i < missing.length; i += BATCH_SIZE) {
			batches.push(missing.slice(i, i + BATCH_SIZE));
		}
		Promise.allSettled(batches.map(fetchBatch)).then(() => {
			if (!cancelled) setVersion((v) => v + 1);
		});
		return () => {
			cancelled = true;
		};
	}, [key]);

	return useMemo(() => {
		const result: Record<string, AnimeEntryLink[]> = {};
		if (!key) return result;
		for (const id of key.split(',')) {
			const entries = cache.get(id);
			if (entries) result[id] = entries;
		}
		return result;
		// `version` is what tells this memo the cache filled in.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key, version]);
}

/** Test hook: forget every fetched answer. */
export function clearAnimeEntriesCache(): void {
	cache.clear();
}
