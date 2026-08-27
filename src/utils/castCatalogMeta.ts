import { getMdblistCacheService } from '@/services/database/mdblistCache';
import { NextApiRequest, NextApiResponse } from 'next';
import { isLegacyToken } from './castApiHelpers';

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

/**
 * Stremio passes catalog extras as path segments, not a query string:
 * `.../casted-movies/skip=24.json`. Clients differ on how they pack several —
 * `skip=24&genre=Action.json` in one segment, `skip=24/limit=25.json` across
 * two — so accept both rather than 404 on the shape we did not expect.
 */
export function parseCatalogExtra(raw: string | string[] | undefined): Record<string, string> {
	const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
	const extra: Record<string, string> = {};

	for (const segment of segments) {
		let decoded = segment;
		try {
			decoded = decodeURIComponent(segment);
		} catch {
			// A malformed escape is not worth failing the whole request over.
		}

		for (const pair of decoded.replace(/\.json$/, '').split('&')) {
			const eq = pair.indexOf('=');
			if (eq > 0) {
				extra[pair.slice(0, eq)] = pair.slice(eq + 1);
			}
		}
	}

	return extra;
}

/**
 * How many entries the client already has. Anything unparseable means "start
 * from the top" — a bad extra should still return a catalog, not an error.
 */
export function skipFromExtra(extra: Record<string, string>): number {
	const skip = Number.parseInt(extra.skip ?? '', 10);
	return Number.isSafeInteger(skip) && skip > 0 ? skip : 0;
}

/**
 * The paged half of a casted catalog: everything past what the client already
 * holds. Clients page by "entries received so far", so the tail is what they
 * are asking for; once it runs out they get an empty page and stop.
 */
export function createCastCatalogPageHandler(options: {
	type: CastCatalogType;
	fetchIds: (userid: string) => Promise<string[]>;
	errorLabel: string;
}) {
	const { type, fetchIds, errorLabel } = options;

	return async function handler(req: NextApiRequest, res: NextApiResponse) {
		res.setHeader('access-control-allow-origin', '*');

		if (req.method === 'OPTIONS') {
			return res.status(200).end();
		}

		const { userid } = req.query;
		if (typeof userid !== 'string') {
			return res.status(400).json({
				status: 'error',
				errorMessage: 'Invalid "userid" query parameter',
			});
		}

		// The first page already carried the upgrade notice; do not repeat it.
		if (isLegacyToken(userid)) {
			return res.status(200).json({ metas: [], cacheMaxAge: 0 });
		}

		try {
			const skip = skipFromExtra(parseCatalogExtra(req.query.extra as string | string[]));
			const imdbIds = (await fetchIds(userid)).slice(skip);
			res.status(200).json({
				metas: await buildCatalogMetas(imdbIds, type),
				hasMore: false,
				cacheMaxAge: 0,
			});
		} catch (error) {
			console.error(
				`Failed to get ${errorLabel}:`,
				error instanceof Error ? error.message : 'Unknown error'
			);
			res.status(500).json({ error: `Failed to get ${errorLabel}` });
		}
	};
}
