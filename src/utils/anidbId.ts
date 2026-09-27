/**
 * The AniDB id in an `/anime/...` path.
 *
 * The page is `/anime/17617`. The anime page deleted in a5f0a87e lived at
 * `/anime/anidb-17617`, and search hands ids out as `anime:anidb-17617`, so
 * both spellings are read too and the page redirects them to the bare form.
 */
export function parseAnidbIdParam(raw: unknown): number | null {
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (typeof value !== 'string') return null;
	const match = /^(?:anime:)?(?:anidb[-:])?(\d{1,7})$/i.exec(value.trim());
	if (!match) return null;
	const id = parseInt(match[1], 10);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * The anime page for a search result id: `/anime/17617` for `anime:anidb-17617`,
 * and `/anime/mal-1278` for a row search could only name by its MAL id.
 */
export function animePagePath(searchId: string): string | null {
	const anidb = /^anime:anidb-(\d+)$/.exec(searchId)?.[1];
	if (anidb) return `/anime/${anidb}`;
	const mal = /^anime:mal-(\d+)$/.exec(searchId)?.[1];
	return mal ? `/anime/mal-${mal}` : null;
}

/** Which entry an `/anime/...` page shows. */
export interface AnimePageId {
	source: 'anidb' | 'mal';
	id: number;
	/** The id as the anime routes take it, and after `anime:` as releases are keyed. */
	slug: string;
	/** The path segment the page lives at: `17617`, or `mal-52991`. */
	path: string;
}

/**
 * The page's id. An `Anime` row with no AniDB id is addressed by its MAL id,
 * `/anime/mal-52991`, which is where the Stremio handlers link such a row;
 * its releases are keyed `anime:mal-<id>`.
 */
export function parseAnimePageId(raw: unknown): AnimePageId | null {
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (typeof value === 'string') {
		const mal = /^(?:anime:)?mal[-:](\d{1,7})$/i.exec(value.trim());
		if (mal) {
			const id = parseInt(mal[1], 10);
			if (id > 0) return { source: 'mal', id, slug: `mal-${id}`, path: `mal-${id}` };
			return null;
		}
	}
	const anidb = parseAnidbIdParam(value);
	return anidb === null
		? null
		: { source: 'anidb', id: anidb, slug: `anidb-${anidb}`, path: String(anidb) };
}
