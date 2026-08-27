import { getMdblistCacheService } from '@/services/database/mdblistCache';

export type CastCatalogType = 'movie' | 'series';

/**
 * Meta previews for a casted catalog.
 *
 * `name` is required on a meta preview. Stremio's own clients get away without
 * it — stremio-core defaults the field to an empty string and labels the tile
 * from Cinemeta — but third-party clients drop entries that have no name, which
 * is why casted catalogs rendered empty in them. Titles come from the MDBList
 * cache the content page already filled in; anything still missing falls back
 * to the id so the entry renders rather than disappears.
 */
export async function buildCatalogMetas(imdbIds: string[], type: CastCatalogType) {
	const titles = await getMdblistCacheService().getTitles(imdbIds);
	return imdbIds.map((imdbId) => ({
		id: imdbId,
		type,
		name: titles.get(imdbId) ?? imdbId,
		poster: `https://images.metahub.space/poster/small/${imdbId}/img`,
	}));
}
