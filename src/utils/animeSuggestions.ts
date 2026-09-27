import type { AnimeSearchResult } from '@/services/database/anime';
import { animePagePath } from '@/utils/anidbId';
import axios from 'axios';

/** Anime rows the quick-search dropdown shows, below the movies and shows. */
export const ANIME_SUGGESTION_LIMIT = 3;

/**
 * Two letters are left to Trakt. Every distinct keyword is its own upstream
 * search behind `/api/search/anime`, and two letters of a romanized title
 * match almost anything.
 */
export const ANIME_SUGGESTION_MIN_LENGTH = 3;

/**
 * `/api/search/anime` allows an address 30 requests a minute, and the anime
 * page's `/api/info/anime` spends the same budget. Typing past the 300 ms
 * debounce asks once per letter, so a slow typist searching three titles in a
 * minute would otherwise lock the anime page they are about to open. The
 * dropdown stops asking at 20 and leaves the rest to the pages.
 */
export const ANIME_SUGGESTION_REQUESTS_PER_MINUTE = 20;

const WINDOW_MS = 60_000;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 100;
const REQUEST_TIMEOUT_MS = 10_000;

type Entry = { at: number; rows: Promise<AnimeSearchResult[]> };

const cache = new Map<string, Entry>();
let sentAt: number[] = [];
let pausedUntil = 0;

/**
 * The rows worth a line in the dropdown: each links to an anime page, once.
 * Search hands out `anime:mal-null` for a row with neither an AniDB nor a MAL
 * id ("dou po" has two), and there is no page to send those to.
 */
export function pickAnimeSuggestions(results: unknown): AnimeSearchResult[] {
	if (!Array.isArray(results)) return [];
	const seen = new Set<string>();
	const rows: AnimeSearchResult[] = [];
	for (const row of results as Partial<AnimeSearchResult>[]) {
		if (typeof row?.id !== 'string' || typeof row.title !== 'string') continue;
		const path = animePagePath(row.id);
		if (!path || seen.has(path)) continue;
		seen.add(path);
		rows.push(row as AnimeSearchResult);
		if (rows.length === ANIME_SUGGESTION_LIMIT) break;
	}
	return rows;
}

function retryAfterMs(error: unknown): number | null {
	const response = (
		error as { response?: { status?: number; headers?: Record<string, unknown> } }
	)?.response;
	if (response?.status !== 429) return null;
	const seconds = Number(response.headers?.['retry-after']);
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : WINDOW_MS;
}

/**
 * Anime matches for what is typed. Each query is asked once and kept for five
 * minutes, so backspacing and retyping costs nothing. Resolves to no rows when
 * the query is too short or the dropdown has spent its share of the budget,
 * and rejects when the request itself failed; neither is kept.
 */
export function fetchAnimeSuggestions(
	query: string,
	now: number = Date.now()
): Promise<AnimeSearchResult[]> {
	const keyword = query.trim().toLocaleLowerCase();
	if (keyword.length < ANIME_SUGGESTION_MIN_LENGTH) return Promise.resolve([]);

	const hit = cache.get(keyword);
	if (hit && now - hit.at < CACHE_TTL_MS) return hit.rows;

	sentAt = sentAt.filter((at) => now - at < WINDOW_MS);
	if (now < pausedUntil || sentAt.length >= ANIME_SUGGESTION_REQUESTS_PER_MINUTE) {
		return Promise.resolve([]);
	}
	sentAt.push(now);

	const rows = axios
		.get<{ results?: unknown }>(`/api/search/anime?keyword=${encodeURIComponent(keyword)}`, {
			timeout: REQUEST_TIMEOUT_MS,
		})
		.then((response) => pickAnimeSuggestions(response.data?.results))
		.catch((error: unknown) => {
			if (cache.get(keyword)?.rows === rows) cache.delete(keyword);
			// A refused request still counts against the window, so asking
			// again before it ends only pushes the end further away.
			const wait = retryAfterMs(error);
			if (wait !== null) pausedUntil = Math.max(pausedUntil, now + wait);
			throw error;
		});

	cache.delete(keyword);
	cache.set(keyword, { at: now, rows });
	if (cache.size > CACHE_MAX_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	return rows;
}

/** Forget every cached query and spent request. Tests only. */
export function resetAnimeSuggestions(): void {
	cache.clear();
	sentAt = [];
	pausedUntil = 0;
}
