// TVDB series id for an IMDb id, used to key Usenet searches.
//
// The Newznab indexer matches TV releases against TVDB, not IMDb — see the note
// on `buildSearchUrl` in services/nzb2rd. MDBList already answers with a tvdbid,
// and the show page has warmed that lookup through /api/info/show by the time
// anyone opens the Usenet section, so this is a cache read in the normal case.

import { getMdblistClient } from './mdblistClient';

/**
 * MDBList is inconsistent about whether ids come back as numbers or numeric
 * strings, and sends 0/null for a title it has not mapped.
 */
export function tvdbIdFrom(info: unknown): number | undefined {
	const raw = (info as { tvdbid?: unknown } | null)?.tvdbid;
	const id = typeof raw === 'string' ? Number(raw) : raw;
	if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return undefined;
	return id;
}

/**
 * Best-effort: a failed lookup falls back to the IMDb id rather than failing the
 * search, which is what the caller did before this existed.
 */
export async function resolveTvdbId(imdbId: string): Promise<number | undefined> {
	try {
		return tvdbIdFrom(await getMdblistClient().getInfoByImdbId(imdbId));
	} catch (error) {
		console.error(`TVDB id lookup failed for ${imdbId} (falling back to IMDb id):`, error);
		return undefined;
	}
}
