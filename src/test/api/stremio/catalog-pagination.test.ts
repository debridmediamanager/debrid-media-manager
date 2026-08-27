import adMovies from '@/pages/api/stremio-ad/[userid]/catalog/movie/ad-casted-movies/[...extra]';
import adShows from '@/pages/api/stremio-ad/[userid]/catalog/series/ad-casted-shows/[...extra]';
import pmMovies from '@/pages/api/stremio-pm/[userid]/catalog/movie/pm-casted-movies/[...extra]';
import pmShows from '@/pages/api/stremio-pm/[userid]/catalog/series/pm-casted-shows/[...extra]';
import tbMovies from '@/pages/api/stremio-tb/[userid]/catalog/movie/tb-casted-movies/[...extra]';
import tbShows from '@/pages/api/stremio-tb/[userid]/catalog/series/tb-casted-shows/[...extra]';
import rdMovies from '@/pages/api/stremio/[userid]/catalog/movie/casted-movies/[...extra]';
import rdShows from '@/pages/api/stremio/[userid]/catalog/series/casted-shows/[...extra]';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/database/mdblistCache', () => ({
	getMdblistCacheService: () => ({ getTitles: vi.fn().mockResolvedValue(new Map()) }),
}));

const mockRepository = vi.mocked(repository);

/**
 * Every DMM Cast catalog is paginated by clients that append the extra as a
 * path segment — Prism sends `skip=1`, Strand `skip=100`, AIOMetadata `skip=50`.
 * Only the RD "other" catalog served that shape, so every other catalog 404'd
 * the moment a client asked for a second page.
 */
const catalogs = [
	{ name: 'RD movies', handler: rdMovies, method: 'fetchCastedMovies', type: 'movie' },
	{ name: 'RD shows', handler: rdShows, method: 'fetchCastedShows', type: 'series' },
	{ name: 'TB movies', handler: tbMovies, method: 'fetchTorBoxCastedMovies', type: 'movie' },
	{ name: 'TB shows', handler: tbShows, method: 'fetchTorBoxCastedShows', type: 'series' },
	{ name: 'AD movies', handler: adMovies, method: 'fetchAllDebridCastedMovies', type: 'movie' },
	{ name: 'AD shows', handler: adShows, method: 'fetchAllDebridCastedShows', type: 'series' },
	{ name: 'PM movies', handler: pmMovies, method: 'fetchPremiumizeCastedMovies', type: 'movie' },
	{ name: 'PM shows', handler: pmShows, method: 'fetchPremiumizeCastedShows', type: 'series' },
] as const;

describe('casted catalog pagination', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each(catalogs)('$name serves a skip page from its own provider', async (catalog) => {
		(mockRepository as any)[catalog.method] = vi.fn().mockResolvedValue(['tt1', 'tt2', 'tt3']);
		const req = createMockRequest({
			query: { userid: 'user123', extra: ['skip=2.json'] },
		});
		const res = createMockResponse();

		await catalog.handler(req, res);

		expect((mockRepository as any)[catalog.method]).toHaveBeenCalledWith('user123');
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				metas: [{ id: 'tt3', type: catalog.type, name: 'tt3', poster: expect.any(String) }],
			})
		);
	});

	it.each(catalogs)('$name names every entry it returns', async (catalog) => {
		(mockRepository as any)[catalog.method] = vi.fn().mockResolvedValue(['tt1', 'tt2']);
		const req = createMockRequest({ query: { userid: 'user123', extra: ['skip=0.json'] } });
		const res = createMockResponse();

		await catalog.handler(req, res);

		const { metas } = (res.json as any).mock.calls[0][0];
		expect(metas).toHaveLength(2);
		for (const meta of metas) {
			expect(meta.name).toBeTruthy();
		}
	});
});
