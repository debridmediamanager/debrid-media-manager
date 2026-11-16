// What each upstream is asked for one client search: the ids it can search by,
// read from its own caps, instead of every id to every upstream.
//
// Measured 2026-11-16 over seven shows (fixture upstream-caps-2026-11-16.json):
//   * NZBgeek and NzbLife take no IMDb id in a TV search. NZBgeek answers one with
//     nothing, NzbLife with that episode of every show (see ignoredIds).
//   * Sent both ids at once, altHUB and NZBgeek answer nothing or another show.
//   * A TVDB id alone found at least as many of the show's posts as any other
//     choice on every upstream: DrunkenSlug has Frieren only by TVDB id, altHUB
//     The Bear S02 only by TVDB id, NZBAtlas finds nothing by IMDb id at all.
// So a TV search sends one id, the TVDB id first, looked up from the IMDb id when
// the client sent only that, and an upstream that can take none of the ids it
// was given is not asked: its answer would be about another title.

import { TMDB_TV_APPEND } from '@/services/metadata';
import { getMetadataCache } from '@/services/metadataCache';
import type { UpstreamIndexer } from './indexers';

type Mode = 'search' | 'tvsearch' | 'movie';

/** One search mode from caps. `params` null = available, list not stated. */
export interface ModeCaps {
	available: boolean;
	params: Set<string> | null;
}

/** A mode missing from the caps is unknown and asked as before. */
export type UpstreamCaps = Partial<Record<Mode, ModeCaps>>;

const ELEMENT: Record<Mode, string> = {
	search: 'search',
	tvsearch: 'tv-search',
	movie: 'movie-search',
};

/** The search modes in a `t=caps` answer, or null when it is not one. */
export function parseCaps(xml: string): UpstreamCaps | null {
	if (!/<caps[\s>]/.test(xml)) return null;
	const caps: UpstreamCaps = {};
	for (const mode of Object.keys(ELEMENT) as Mode[]) {
		const tag = new RegExp(`<${ELEMENT[mode]}\\b([^>]*)>`).exec(xml)?.[1];
		if (tag === undefined) continue;
		const available = /available\s*=\s*"([^"]*)"/.exec(tag)?.[1].toLowerCase() !== 'no';
		const list = /supportedParams\s*=\s*"([^"]*)"/.exec(tag)?.[1];
		caps[mode] = {
			available,
			params:
				list === undefined
					? null
					: new Set(
							list
								.split(',')
								.map((p) => p.trim().toLowerCase())
								.filter(Boolean)
						),
		};
	}
	return caps;
}

/**
 * What `indexer` is sent for `params`, or null when it cannot answer the search.
 * `caps` null (unread) asks it as before, except that a TV search still sends one id.
 */
export function paramsFor(
	caps: UpstreamCaps | null,
	t: Mode,
	params: Record<string, string>,
	lookedUpTvdbId?: string
): Record<string, string> | null {
	const mode = caps?.[t];
	if (mode && !mode.available) return null;
	const takes = (name: string) => !mode?.params || mode.params.has(name);

	const { imdbid, tvdbid, ...rest } = params;
	const ids: [string, string | undefined][] =
		t === 'tvsearch'
			? [
					['tvdbid', tvdbid ?? lookedUpTvdbId],
					['imdbid', imdbid],
				]
			: [
					['imdbid', imdbid],
					['tvdbid', tvdbid],
				];
	const known = ids.filter((id): id is [string, string] => !!id[1]);
	if (known.length > 0) {
		const id = known.find(([name]) => takes(name));
		if (!id) return null;
		rest[id[0]] = id[1];
	}
	if (rest.q !== undefined && !takes('q')) return null;
	return rest;
}

const CAPS_TTL_MS = 24 * 60 * 60 * 1000;
const CAPS_RETRY_MS = 10 * 60 * 1000;
const capsCache = new Map<string, { caps: UpstreamCaps | null; until: number }>();

/** The indexer's caps, read once a day per instance; null while unreadable. */
export async function upstreamCaps(indexer: UpstreamIndexer): Promise<UpstreamCaps | null> {
	const key = `${indexer.prefix}|${indexer.url}`;
	const hit = capsCache.get(key);
	if (hit && hit.until > Date.now()) return hit.caps;
	let caps: UpstreamCaps | null = null;
	try {
		const query = new URLSearchParams({ t: 'caps' });
		if (!indexer.keyless) query.set('apikey', indexer.apiKey);
		const res = await fetch(`${indexer.url}?${query}`, { signal: AbortSignal.timeout(10_000) });
		caps = res.ok ? parseCaps(await res.text()) : null;
	} catch {
		caps = null;
	}
	if (!caps) console.warn(`Newznab: could not read caps of ${indexer.name}`);
	capsCache.set(key, { caps, until: Date.now() + (caps ? CAPS_TTL_MS : CAPS_RETRY_MS) });
	return caps;
}

/** The show's TVDB id from TMDB (the show page's cached row), or undefined. */
export async function tvdbIdOfShow(imdbDigits: string): Promise<string | undefined> {
	try {
		const cache = getMetadataCache();
		const found = await cache.searchTmdbByImdb(`tt${imdbDigits.padStart(7, '0')}`);
		const tmdbId = found?.tv_results?.[0]?.id;
		if (typeof tmdbId !== 'number') return undefined;
		const tvdb = (await cache.getTmdbTvInfo(tmdbId, TMDB_TV_APPEND))?.external_ids?.tvdb_id;
		return typeof tvdb === 'number' && tvdb > 0 ? String(tvdb) : undefined;
	} catch {
		return undefined;
	}
}

/** Each indexer that can answer the search, with what it is sent, in the order given. */
export async function upstreamPlan(
	t: Mode,
	params: Record<string, string>,
	indexers: UpstreamIndexer[]
): Promise<Map<UpstreamIndexer, Record<string, string>>> {
	const lookedUp =
		t === 'tvsearch' && params.imdbid && !params.tvdbid
			? await tvdbIdOfShow(params.imdbid)
			: undefined;
	const caps = await Promise.all(indexers.map(upstreamCaps));
	const plan = new Map<UpstreamIndexer, Record<string, string>>();
	indexers.forEach((indexer, i) => {
		const sent = paramsFor(caps[i], t, params, lookedUp);
		if (sent) plan.set(indexer, sent);
	});
	return plan;
}

/** Tests only. */
export function _resetUpstreamCapsForTest(): void {
	capsCache.clear();
}
