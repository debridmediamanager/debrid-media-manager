import addonFateZero from '@/test/fixtures/anime/addon-search-fate-zero.json';
import rowsByKitsuId from '@/test/fixtures/anime/anime-rows-kitsu-fate-zero.json';
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
			{ title: 'Bleach', anidb_id: 2, mal_id: null, kitsu_id: 1, poster_url: 'poster' },
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

	// The addon ranks "Fate/Zero" first; production's findMany hands the rows
	// back in kitsu_id order, which put Gravitation (kitsu 218) at the top.
	it('keeps the order the search upstream ranked the ids in', async () => {
		prismaMock.anime.findMany.mockResolvedValue(structuredClone(rowsByKitsuId));
		const ranked = addonFateZero.requests[1].body as { metas: { id: string; name: string }[] };
		const ids = ranked.metas.map((m) => parseInt(m.id.replace('kitsu:', ''), 10));

		const results = await service.getAnimeByKitsuIds(ids);

		const titleOf = new Map(rowsByKitsuId.map((r) => [r.kitsu_id, r.title]));
		expect(results.map((r) => r.title)).toEqual(ids.map((id) => titleOf.get(id)));
		expect(results[0].title).toBe('Fate/Zero');
		expect(results[0]).toEqual({
			id: 'anime:anidb-8160',
			title: 'Fate/Zero',
			poster_url: rowsByKitsuId.find((r) => r.kitsu_id === 6028)!.poster_url,
		});
	});
});
