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

/** The anime page for a search result id, or null for one with no AniDB id (`anime:mal-N`). */
export function animePagePath(searchId: string): string | null {
	const id = /^anime:anidb-(\d+)$/.exec(searchId)?.[1];
	return id ? `/anime/${id}` : null;
}
