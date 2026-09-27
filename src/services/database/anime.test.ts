import addonFateZero from '@/test/fixtures/anime/addon-search-fate-zero.json';
import rowsByKitsuId from '@/test/fixtures/anime/anime-rows-kitsu-fate-zero.json';
import searchRows from '@/test/fixtures/anime/anime-rows-search-frieren.json';
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

const frierenRow = searchRows.find((r) => r.anidb_id === 17617)!;

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
			poster_url: rowsByKitsuId
				.find((r) => r.kitsu_id === 6028)!
				.poster_url.replace('media.kitsu.io', 'media.kitsu.app'),
		});
	});

	// Every row in this fixture stores its poster under media.kitsu.io, which
	// answers 404 since Kitsu moved to media.kitsu.app; production's search for
	// "frieren" handed out four such URLs, all broken.
	it("serves posters from Kitsu's current media host", async () => {
		expect(rowsByKitsuId.every((r) => r.poster_url.startsWith('https://media.kitsu.io/'))).toBe(
			true
		);
		prismaMock.anime.findMany.mockResolvedValue(structuredClone(rowsByKitsuId));

		const results = await service.getAnimeByKitsuIds(rowsByKitsuId.map((r) => r.kitsu_id));

		expect(
			results.every((r) => r.poster_url.startsWith('https://media.kitsu.app/anime/'))
		).toBe(true);
	});

	it('moves an entry row and a franchise row to the current host too', async () => {
		const frieren = { ...frierenRow };
		prismaMock.anime.findUnique.mockResolvedValue(frieren);
		prismaMock.anime.findMany.mockResolvedValue([frieren]);

		const row = await service.getAnimeByExternalId('anidb', 17617);
		const [entry] = await service.getAnimeEntryRows({ anidbIds: [17617], imdbIds: [] });

		expect(row!.poster_url).toBe(
			'https://media.kitsu.app/anime/46474/poster_image/medium-23e1293e41a0b54b6621eb589c3f0d62.jpeg'
		);
		// fanart.tv is not Kitsu's and is left alone.
		expect(row!.background_url).toBe(frieren.background_url);
		expect(entry.poster_url).toBe(row!.poster_url);
	});
});
