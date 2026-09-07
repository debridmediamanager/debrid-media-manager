/**
 * Simkl, used to resolve an anime's IMDb id from the id we already hold.
 *
 * Anime rows are keyed by anidb/mal/kitsu ids, but every other DMM surface —
 * search, Stremio, torznab — is keyed by IMDb id, and most rows still have
 * none. Simkl maps between them in one call.
 *
 * Every Simkl endpoint requires a client id; without `SIMKL_CLIENT_ID` the
 * whole module no-ops rather than issuing calls that come back 412.
 */

export const SIMKL_API_BASE = 'https://api.simkl.com';

export type SimklExternalId = 'anidb' | 'mal' | 'kitsu' | 'imdb' | 'tmdb' | 'tvdb';

export interface SimklIds {
	simkl: number | null;
	imdb: string | null;
	tmdb: number | null;
	tvdb: number | null;
	mal: number | null;
	anidb: number | null;
}

export type Fetcher = typeof fetch;

export function getSimklClientId(): string | null {
	return process.env.SIMKL_CLIENT_ID?.trim() || null;
}

export function isSimklConfigured(): boolean {
	return getSimklClientId() !== null;
}

const asInt = (value: unknown): number | null => {
	const parsed = typeof value === 'string' ? parseInt(value, 10) : value;
	return typeof parsed === 'number' && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const asImdbId = (value: unknown): string | null =>
	typeof value === 'string' && /^tt\d+$/.test(value.trim()) ? value.trim() : null;

export function normalizeSimklIds(ids: Record<string, unknown> | undefined): SimklIds | null {
	if (!ids || typeof ids !== 'object') return null;
	const normalized: SimklIds = {
		simkl: asInt(ids.simkl ?? ids.simkl_id),
		imdb: asImdbId(ids.imdb),
		tmdb: asInt(ids.tmdb),
		tvdb: asInt(ids.tvdb),
		mal: asInt(ids.mal),
		anidb: asInt(ids.anidb),
	};
	// An entry that resolved nothing is not worth handing back.
	return Object.values(normalized).some((value) => value !== null) ? normalized : null;
}

/**
 * Look a title up by an id we already have. Returns null when Simkl is not
 * configured, the lookup fails, or nothing matches — callers treat all three
 * the same way, by falling through to whatever they had before.
 */
export async function lookupSimklIds(
	source: SimklExternalId,
	id: string | number,
	fetcher: Fetcher = fetch
): Promise<SimklIds | null> {
	const clientId = getSimklClientId();
	if (!clientId) return null;

	const value = String(id).trim();
	if (!value) return null;

	try {
		const url = `${SIMKL_API_BASE}/search/id?${source}=${encodeURIComponent(value)}&client_id=${encodeURIComponent(clientId)}`;
		const res = await fetcher(url);
		if (!res.ok) return null;

		const body = await res.json();
		if (!Array.isArray(body) || body.length === 0) return null;

		for (const entry of body) {
			const ids = normalizeSimklIds(entry?.ids);
			if (ids) return ids;
		}
		return null;
	} catch {
		return null;
	}
}

/** Convenience for the common case: an anidb id in, an IMDb id out. */
export async function resolveImdbIdFromSimkl(
	source: SimklExternalId,
	id: string | number,
	fetcher: Fetcher = fetch
): Promise<string | null> {
	const ids = await lookupSimklIds(source, id, fetcher);
	return ids?.imdb ?? null;
}
