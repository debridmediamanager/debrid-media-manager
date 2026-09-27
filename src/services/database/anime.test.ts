import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { AnimeService } from './anime';

const prismaMock = vi.hoisted(() => ({
	anime: {
		findMany: vi.fn(),
		findUnique: vi.fn(),
	},
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

describe('AnimeService', () => {
	let service: AnimeService;

	beforeEach(() => {
		service = new AnimeService();
		(prismaMock.anime.findMany as Mock).mockReset();
		(prismaMock.anime.findUnique as Mock).mockReset();
	});

	it('loads anime entries by Kitsu ids', async () => {
		prismaMock.anime.findMany.mockResolvedValue([
			{ title: 'Bleach', anidb_id: 2, mal_id: null, poster_url: 'poster' },
		]);

		const result = await service.getAnimeByKitsuIds([1]);
		expect(result).toEqual([{ id: 'anime:anidb-2', title: 'Bleach', poster_url: 'poster' }]);
	});

	it.each([
		['anidb', 17617, { anidb_id: 17617 }],
		['mal', 52991, { mal_id: 52991 }],
		['kitsu', 46474, { kitsu_id: 46474 }],
	] as const)('looks a row up by its %s id', async (source, id, where) => {
		prismaMock.anime.findUnique.mockResolvedValue(null);

		await service.getAnimeByExternalId(source, id);

		expect(prismaMock.anime.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where })
		);
	});
});
