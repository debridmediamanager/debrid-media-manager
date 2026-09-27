import { searchKitsuAnimeIds } from '@/services/anime/kitsu';
import { AnimeSearchResult } from '@/services/database/anime';
import { repository as db } from '@/services/repository';
import { BoundedTtlCache } from '@/utils/boundedTtlCache';
import { NextApiHandler } from 'next';

// Kitsu's catalogue changes by the season, not by the hour. Every distinct
// keyword used to stay in memory for the life of the process, answered forever
// with whatever it matched the first time.
const KEYWORD_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const KEYWORD_CACHE_MAX_ENTRIES = 1000;
const keywordCache = new BoundedTtlCache<number[]>(KEYWORD_CACHE_TTL_MS, KEYWORD_CACHE_MAX_ENTRIES);

// The keyword is a path segment here, so `Fate/Zero` or a trailing `?` used to
// change which resource was asked for; the addon answers those with a 404.
const CATALOG_URL = (keyword: string) =>
	`https://anime-kitsu.strem.fun/catalog/anime/kitsu-anime-list/search=${encodeURIComponent(keyword)}.json`;

/**
 * The community addon that has served this search until now. Returns null when
 * the addon itself failed, which is different from it reporting no matches —
 * only the former should fall through to a 500 if nothing else answers.
 */
async function searchViaStremioAddon(keyword: string): Promise<number[] | null> {
	try {
		const res = await fetch(CATALOG_URL(keyword));
		if (res.ok === false) return null;
		const body = await res.json();
		if (!Array.isArray(body?.metas)) return null;

		return body.metas
			.map((anime: { id?: unknown }) =>
				parseInt(String(anime?.id ?? '').replace('kitsu:', ''), 10)
			)
			.filter((id: number) => Number.isInteger(id) && id > 0);
	} catch {
		return null;
	}
}

const handler: NextApiHandler = async (req, res) => {
	const { keyword } = req.query;

	if (!keyword || !(typeof keyword === 'string')) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "keyword" query parameter',
		});
		return;
	}

	try {
		const normalized = keyword.toLocaleLowerCase();
		let kitsuIds = keywordCache.get(normalized);

		if (!kitsuIds) {
			// The addon stays primary; Kitsu's own API answers the same search
			// when it is down, so an outage no longer empties anime search.
			const viaAddon = await searchViaStremioAddon(normalized);

			if (viaAddon !== null && viaAddon.length > 0) {
				kitsuIds = viaAddon;
			} else {
				const viaKitsu = await searchKitsuAnimeIds(normalized);
				// Both upstreams unreachable is an error, not an empty result set:
				// answering "no matches" would be a lie the caller cannot detect.
				// Either one answering "no matches" is a real answer, though.
				if (viaAddon === null && viaKitsu === null) {
					throw new Error('anime search upstreams are unavailable');
				}
				kitsuIds = viaKitsu ?? [];
			}

			// A failed lookup must not be cached as "this keyword has no results".
			if (kitsuIds.length > 0) keywordCache.set(normalized, kitsuIds);
		}

		const results: AnimeSearchResult[] =
			kitsuIds.length > 0 ? await db.getAnimeByKitsuIds(kitsuIds) : [];
		res.status(200).json({ results });
	} catch (error) {
		console.error('An error occurred while fetching the data:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: 'An error occurred while fetching the data',
		});
	}
};

export default handler;
