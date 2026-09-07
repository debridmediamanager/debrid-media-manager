/**
 * TMDB authentication.
 *
 * TMDB accepts two different credentials: the v3 API key, passed as an
 * `api_key` query parameter, and the v4 read access token, passed as a bearer
 * header. They are not interchangeable — sending a v3 key as a bearer token is
 * rejected with a 401 — and the v4 token is the one that reaches the list
 * endpoints.
 *
 * Set `TMDB_READ_TOKEN` to authenticate with the v4 token. Without it nothing
 * changes: callers keep using `TMDB_KEY` exactly as before.
 */
import { getTmdbKey } from './freekeys';

export const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

export interface TmdbAuth {
	/** Bearer header for the v4 token; empty when authenticating by api_key. */
	headers: Record<string, string>;
	/** The v3 key, or null when the bearer token is in use. */
	apiKey: string | null;
}

/**
 * Resolve the configured credential, or null when there is none. Callers that
 * treat a missing key as an error keep doing so; the v4 token now counts as
 * configured.
 */
export function getTmdbAuth(fallbackKey?: string | null): TmdbAuth | null {
	const readToken = process.env.TMDB_READ_TOKEN?.trim();
	if (readToken) {
		return { headers: { Authorization: `Bearer ${readToken}` }, apiKey: null };
	}

	const key = process.env.TMDB_KEY?.trim() || fallbackKey?.trim() || null;
	return key ? { headers: {}, apiKey: key } : null;
}

/**
 * For the call sites that already fall back to the shared free-key pool rather
 * than failing when nothing is configured.
 */
export function getTmdbAuthWithFreeKey(): TmdbAuth {
	return getTmdbAuth() ?? { headers: {}, apiKey: getTmdbKey() };
}

/**
 * Build a TMDB URL, appending `api_key` only when authenticating that way.
 * Empty and undefined parameters are dropped rather than serialised as the
 * literal "undefined", which TMDB reads as a value.
 */
export function tmdbUrl(
	path: string,
	params: Record<string, string | number | boolean | null | undefined> = {},
	auth: TmdbAuth = getTmdbAuthWithFreeKey()
): string {
	const search = new URLSearchParams();
	if (auth.apiKey) search.set('api_key', auth.apiKey);
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null || value === '') continue;
		search.set(key, String(value));
	}
	const query = search.toString();
	const normalizedPath = path.startsWith('/') ? path : `/${path}`;
	return `${TMDB_BASE_URL}${normalizedPath}${query ? `?${query}` : ''}`;
}

/** Request config carrying the bearer header when one is configured. */
export function tmdbRequestConfig(auth: TmdbAuth): { headers: Record<string, string> } {
	return { headers: auth.headers };
}

/**
 * Axios options for the call sites that pass TMDB parameters as `params`.
 * `api_key` is included only under key auth, so a bearer-authenticated request
 * does not also carry an empty key parameter.
 */
export function tmdbAxiosOptions(
	auth: TmdbAuth,
	params: Record<string, string | number | boolean | undefined> = {}
): { headers: Record<string, string>; params: Record<string, string | number | boolean> } {
	const merged: Record<string, string | number | boolean> = {};
	if (auth.apiKey) merged.api_key = auth.apiKey;
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined) continue;
		merged[key] = value;
	}
	return { headers: auth.headers, params: merged };
}
