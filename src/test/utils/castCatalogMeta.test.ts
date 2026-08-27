import { buildCatalogMetas } from '@/utils/castCatalogMeta';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetTitles } = vi.hoisted(() => ({ mockGetTitles: vi.fn() }));

vi.mock('@/services/database/mdblistCache', () => ({
	getMdblistCacheService: () => ({ getTitles: mockGetTitles }),
}));

describe('buildCatalogMetas', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetTitles.mockResolvedValue(new Map());
	});

	it('names every entry, because clients drop meta previews without one', async () => {
		mockGetTitles.mockResolvedValue(new Map([['tt100', 'The Shawshank Redemption']]));

		const metas = await buildCatalogMetas(['tt100', 'tt200'], 'movie');

		expect(metas).toEqual([
			{
				id: 'tt100',
				type: 'movie',
				name: 'The Shawshank Redemption',
				poster: 'https://images.metahub.space/poster/small/tt100/img',
			},
			{
				id: 'tt200',
				type: 'movie',
				name: 'tt200',
				poster: 'https://images.metahub.space/poster/small/tt200/img',
			},
		]);
	});

	it('looks the whole catalog up in one query', async () => {
		await buildCatalogMetas(['tt1', 'tt2', 'tt3'], 'series');

		expect(mockGetTitles).toHaveBeenCalledTimes(1);
		expect(mockGetTitles).toHaveBeenCalledWith(['tt1', 'tt2', 'tt3']);
	});
});
