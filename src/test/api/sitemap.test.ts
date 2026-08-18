import handler, { buildSitemap, clearSitemapCache } from '@/pages/api/sitemap';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { TRAPS_PER_ROTATION, classifyCanary, trapsForRotation } from '@/utils/canary';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetRecentlyUpdatedContent } = vi.hoisted(() => ({
	mockGetRecentlyUpdatedContent: vi.fn(),
}));

vi.mock('@/services/repository', () => ({
	repository: { getRecentlyUpdatedContent: mockGetRecentlyUpdatedContent },
}));

const NOW = 86_400_000 * 100;

describe('/api/sitemap', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearSitemapCache();
		mockGetRecentlyUpdatedContent.mockResolvedValue([
			'movie:tt0111161',
			'tv:tt0903747',
			'movie:tt1375666',
		]);
	});

	it('publishes the current trap rotation', async () => {
		const xml = await buildSitemap(NOW);

		const traps = trapsForRotation(NOW);
		expect(traps).toHaveLength(TRAPS_PER_ROTATION);
		for (const trap of traps) {
			expect(xml).toContain(`/movie/${trap}</loc>`);
		}
	});

	it('publishes real titles alongside the traps', async () => {
		const xml = await buildSitemap(NOW);

		expect(xml).toContain('/movie/tt0111161</loc>');
		expect(xml).toContain('/show/tt0903747</loc>');
		expect(xml).toContain('/browse/recent</loc>');
	});

	it('does not park the traps in a block at the end', async () => {
		const xml = await buildSitemap(NOW);
		const locs = Array.from(xml.matchAll(/<loc>[^<]*<\/loc>/g)).map((m) => m[0]);
		const trapPositions = locs
			.map((loc, index) => ({ imdbId: /tt\d+/.exec(loc)?.[0], index }))
			.filter(({ imdbId }) => classifyCanary(imdbId))
			.map(({ index }) => index);

		expect(trapPositions.length).toBeGreaterThan(0);
		expect(Math.min(...trapPositions)).toBeLessThan(locs.length - trapPositions.length);
	});

	it('still serves when the database is unreachable', async () => {
		mockGetRecentlyUpdatedContent.mockRejectedValue(new Error('db down'));

		const xml = await buildSitemap(NOW);

		expect(xml).toContain('<urlset');
		for (const trap of trapsForRotation(NOW)) {
			expect(xml).toContain(`/movie/${trap}</loc>`);
		}
	});

	it('serves xml and caches the body', async () => {
		const res = createMockResponse();
		await handler(createMockRequest(), res);

		expect(res.setHeader).toHaveBeenCalledWith(
			'Content-Type',
			'application/xml; charset=utf-8'
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(String(res._getData())).toContain('<urlset');

		await handler(createMockRequest(), createMockResponse());
		expect(mockGetRecentlyUpdatedContent).toHaveBeenCalledTimes(1);
	});
});
