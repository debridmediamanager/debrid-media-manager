import split from '@/test/fixtures/hashMap/split-hash-map-2026-10-12.json';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { HashImdbService, pickHashImdbIds, soleKeeps } from './hashImdb';

const prismaMock = vi.hoisted(() => ({
	hashImdb: {
		findFirst: vi.fn(),
		findMany: vi.fn(),
		update: vi.fn(),
		create: vi.fn(),
	},
	available: { findMany: vi.fn() },
	availableAd: { findMany: vi.fn() },
	imdbTitleEpisode: { findMany: vi.fn() },
	imdbTitleBasics: { findUnique: vi.fn(), findMany: vi.fn() },
	scrapedVerdict: { findMany: vi.fn() },
	$queryRaw: vi.fn(),
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

describe('HashImdbService', () => {
	let service: HashImdbService;

	beforeEach(() => {
		service = new HashImdbService();
		(prismaMock.hashImdb.findFirst as Mock).mockReset();
		(prismaMock.hashImdb.findMany as Mock).mockReset();
		(prismaMock.hashImdb.update as Mock).mockReset();
		(prismaMock.hashImdb.create as Mock).mockReset();
	});

	describe('upsertBatch', () => {
		it('updates updatedAt when exact hash+imdbId already exists', async () => {
			prismaMock.hashImdb.findFirst.mockResolvedValue({
				id: 'abc123',
				hash: 'abc123',
				imdbId: 'tt0000001',
			});
			prismaMock.hashImdb.update.mockResolvedValue({});

			const results = await service.upsertBatch([{ hash: 'abc123', imdbId: 'tt0000001' }]);

			expect(results).toEqual([{ id: 'abc123', created: false }]);
			expect(prismaMock.hashImdb.update).toHaveBeenCalledWith({
				where: { id: 'abc123' },
				data: { updatedAt: expect.any(Date) },
			});
			expect(prismaMock.hashImdb.create).not.toHaveBeenCalled();
		});

		it('creates with hash as id when no existing entries for hash', async () => {
			prismaMock.hashImdb.findFirst.mockResolvedValue(null);
			prismaMock.hashImdb.findMany.mockResolvedValue([]);
			prismaMock.hashImdb.create.mockResolvedValue({});

			const results = await service.upsertBatch([{ hash: 'abc123', imdbId: 'tt0000001' }]);

			expect(results).toEqual([{ id: 'abc123', created: true }]);
			expect(prismaMock.hashImdb.create).toHaveBeenCalledWith({
				data: { id: 'abc123', hash: 'abc123', imdbId: 'tt0000001' },
			});
		});

		it('creates with incremented suffix when other entries exist for hash', async () => {
			prismaMock.hashImdb.findFirst.mockResolvedValue(null);
			prismaMock.hashImdb.findMany.mockResolvedValue([{ id: 'abc123' }, { id: 'abc123-1' }]);
			prismaMock.hashImdb.create.mockResolvedValue({});

			const results = await service.upsertBatch([{ hash: 'abc123', imdbId: 'tt0000002' }]);

			expect(results).toEqual([{ id: 'abc123-2', created: true }]);
		});

		it('handles multiple pairs in a single batch', async () => {
			prismaMock.hashImdb.findFirst
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce({ id: 'def456', hash: 'def456', imdbId: 'tt0000002' });
			prismaMock.hashImdb.findMany.mockResolvedValueOnce([]);
			prismaMock.hashImdb.create.mockResolvedValue({});
			prismaMock.hashImdb.update.mockResolvedValue({});

			const results = await service.upsertBatch([
				{ hash: 'abc123', imdbId: 'tt0000001' },
				{ hash: 'def456', imdbId: 'tt0000002' },
			]);

			expect(results).toHaveLength(2);
			expect(results[0]).toEqual({ id: 'abc123', created: true });
			expect(results[1]).toEqual({ id: 'def456', created: false });
		});

		it('handles empty batch', async () => {
			const results = await service.upsertBatch([]);
			expect(results).toEqual([]);
		});
	});

	describe('getByHash', () => {
		it('returns results ordered by createdAt', async () => {
			const expected = [{ id: 'abc123', hash: 'abc123', imdbId: 'tt0000001' }];
			prismaMock.hashImdb.findMany.mockResolvedValue(expected);

			const result = await service.getByHash('abc123');

			expect(result).toEqual(expected);
			expect(prismaMock.hashImdb.findMany).toHaveBeenCalledWith({
				where: { hash: 'abc123' },
				orderBy: { createdAt: 'asc' },
			});
		});
	});

	describe('getByHashes', () => {
		it('returns empty array for empty input', async () => {
			const result = await service.getByHashes([]);
			expect(result).toEqual([]);
			expect(prismaMock.hashImdb.findMany).not.toHaveBeenCalled();
		});

		it('queries multiple hashes', async () => {
			const expected = [
				{ id: 'a', hash: 'a', imdbId: 'tt1' },
				{ id: 'b', hash: 'b', imdbId: 'tt2' },
			];
			prismaMock.hashImdb.findMany.mockResolvedValue(expected);

			const result = await service.getByHashes(['a', 'b']);

			expect(result).toEqual(expected);
			expect(prismaMock.hashImdb.findMany).toHaveBeenCalledWith({
				where: { hash: { in: ['a', 'b'] } },
				orderBy: { createdAt: 'asc' },
			});
		});
	});

	describe('identifyHashes', () => {
		it('reads nothing for input that is not an info hash', async () => {
			const result = await service.identifyHashes(['', 'abc123', 'not-a-hash']);

			expect(result.size).toBe(0);
			expect(prismaMock.hashImdb.findMany).not.toHaveBeenCalled();
		});
	});
});

describe('getHashTitleIds', () => {
	// rows dmmdb held on 2026-10-11 for two of ymsita's releases: "Eta durackaja ljubov"
	// (Crazy, Stupid, Love.) is filed under two films by two page-add rows, so neither
	// counts, and "Yellow Mirror" is mapped to a Simpsons episode, which must count as
	// the show
	const DURACKAJA = '71aaba52718e52ca9f9b3744291a7f1c28cf93a2';
	const YELLOW_MIRROR = '58f03c741f8eb3012a2fbf3caa95c15556a255f8';

	it('collects every source and names an episode by its show', async () => {
		const service = new HashImdbService();
		prismaMock.hashImdb.findMany.mockResolvedValue([
			{ hash: YELLOW_MIRROR, imdbId: 'tt43141030' },
		]);
		prismaMock.available.findMany.mockResolvedValue([
			{ hash: DURACKAJA, imdbId: 'tt1541874' },
			{ hash: DURACKAJA, imdbId: 'not-an-id' },
		]);
		prismaMock.availableAd.findMany.mockResolvedValue([
			{ hash: DURACKAJA, imdbId: 'tt1570728' },
		]);
		prismaMock.imdbTitleEpisode.findMany.mockResolvedValue([
			{ tconst: 'tt43141030', parentTconst: 'tt0096697' },
		]);
		prismaMock.scrapedVerdict.findMany.mockResolvedValue([]);
		prismaMock.$queryRaw.mockResolvedValue([]);

		const ids = await service.getHashTitleIds([DURACKAJA.toUpperCase(), YELLOW_MIRROR, 'x']);

		expect(prismaMock.hashImdb.findMany).toHaveBeenCalledWith({
			where: { hash: { in: [DURACKAJA, YELLOW_MIRROR] } },
			select: { hash: true, imdbId: true },
		});
		expect(ids).toEqual(new Map([[YELLOW_MIRROR, new Set(['tt0096697'])]]));
	});
});

describe('getHashTitleIds when the hash map is split', () => {
	// dmmdb rows of 2026-10-12: each release got a wrong library title (The Devil Wears
	// Prada as its 2026 sequel, Beverly Hills, 90210 as 90210) because one page-add row
	// agreed with the identifier's doubted pick while another source named another title
	it('drops a title only a page-add row names when another source names a different one', async () => {
		const service = new HashImdbService();
		prismaMock.hashImdb.findMany.mockResolvedValue(split.rows.HashImdb);
		prismaMock.available.findMany.mockResolvedValue(split.rows.Available);
		prismaMock.availableAd.findMany.mockResolvedValue(split.rows.AvailableAd);
		prismaMock.scrapedVerdict.findMany.mockResolvedValue(split.rows.ScrapedVerdict);
		prismaMock.$queryRaw.mockResolvedValue(split.rows.TorrentSnapshot);
		prismaMock.imdbTitleEpisode.findMany.mockResolvedValue([]);

		const ids = await service.getHashTitleIds(split.releases.map((r) => r.hash));

		expect(ids).toEqual(new Map(split.releases.map((r) => [r.hash, new Set(r.credible)])));
	});
});

describe('getHashTitleIds from zurg snapshots and kept verdicts', () => {
	// dmmdb rows of 2026-10-12 for two of ymsita's releases nothing else named: the
	// zurg snapshot files a One Piece Log episode under the show (Available has One
	// Piece), and a kept verdict files "Redline.mkv" under Redline (2009)
	const ONE_PIECE_LOG = '6ca1db218506e01169db19d971dfb7b967c1182a';
	const REDLINE = 'bf54917ffcd0eafa4b7410062ca8769cdb8b5646';

	it('adds the IMDb id a snapshot carries and the titles a verdict kept', async () => {
		const service = new HashImdbService();
		prismaMock.hashImdb.findMany.mockResolvedValue([]);
		prismaMock.available.findMany.mockResolvedValue([
			{ hash: ONE_PIECE_LOG, imdbId: 'tt0388629' },
		]);
		prismaMock.availableAd.findMany.mockResolvedValue([]);
		prismaMock.$queryRaw.mockResolvedValue([
			{ hash: ONE_PIECE_LOG, imdbId: 'tt33992229' },
			{ hash: REDLINE, imdbId: 'tt0232500' },
			{ hash: REDLINE, imdbId: null }, // a snapshot zurg could not match
		]);
		prismaMock.scrapedVerdict.findMany.mockResolvedValue([
			{ hash: REDLINE, imdbId: 'tt1483797' },
		]);
		prismaMock.imdbTitleEpisode.findMany.mockResolvedValue([]);

		const ids = await service.getHashTitleIds([ONE_PIECE_LOG, REDLINE]);

		expect(prismaMock.scrapedVerdict.findMany).toHaveBeenCalledWith({
			where: { hash: { in: [ONE_PIECE_LOG, REDLINE] }, verdict: 'keep' },
			select: { hash: true, imdbId: true },
		});
		expect(ids).toEqual(
			new Map([
				// Available's One Piece is a page-add row the snapshot contradicts
				[ONE_PIECE_LOG, new Set(['tt33992229'])],
				[REDLINE, new Set(['tt0232500', 'tt1483797'])],
			])
		);
	});
});

describe('pickHashImdbIds', () => {
	const A = 'a'.repeat(40);

	it('takes the most trusted source when nothing was judged', () => {
		const picks = pickHashImdbIds(
			[[{ hash: A, imdbId: 'tt0000001' }], [{ hash: A, imdbId: 'tt0000002' }]],
			[]
		);
		expect(picks.get(A)).toBe('tt0000001');
	});

	it('lets a kept pair beat source order', () => {
		const picks = pickHashImdbIds(
			[[{ hash: A, imdbId: 'tt0000001' }], [{ hash: A, imdbId: 'tt0000002' }]],
			[{ hash: A, imdbId: 'tt0000002', verdict: 'keep' }]
		);
		expect(picks.get(A)).toBe('tt0000002');
	});

	it('drops a pair that was trashed and never kept', () => {
		const picks = pickHashImdbIds(
			[[{ hash: A, imdbId: 'tt0000001' }]],
			[{ hash: A, imdbId: 'tt0000001', verdict: 'trash' }]
		);
		expect(picks.has(A)).toBe(false);
	});

	// The verdict is per filename, so one hash can be trashed under one name
	// and kept under another.
	it('keeps a pair that was kept under some name', () => {
		const picks = pickHashImdbIds(
			[[{ hash: A, imdbId: 'tt0000001' }]],
			[
				{ hash: A, imdbId: 'tt0000001', verdict: 'trash' },
				{ hash: A, imdbId: 'tt0000001', verdict: 'keep' },
			]
		);
		expect(picks.get(A)).toBe('tt0000001');
	});

	it('ignores ids metahub cannot draw', () => {
		const picks = pickHashImdbIds(
			[
				[{ hash: A.toUpperCase(), imdbId: 'kitsu:46474' }],
				[{ hash: A, imdbId: 'tt0000002' }],
			],
			[]
		);
		expect(picks.get(A)).toBe('tt0000002');
	});
});

describe('soleKeeps', () => {
	const A = 'a'.repeat(40);
	const B = 'b'.repeat(40);

	it('names a hash after the one title its keeps sit on', () => {
		expect(
			soleKeeps([
				{ hash: A.toUpperCase(), imdbId: 'tt0000001', verdict: 'keep' },
				{ hash: A, imdbId: 'tt0000001', verdict: 'keep' },
				{ hash: A, imdbId: 'tt0000002', verdict: 'trash' },
			])
		).toEqual([{ hash: A, imdbId: 'tt0000001' }]);
	});

	it('names nothing for a set kept on several titles, or a hash only ever trashed', () => {
		expect(
			soleKeeps([
				{ hash: A, imdbId: 'tt0000001', verdict: 'keep' },
				{ hash: A, imdbId: 'tt0000002', verdict: 'keep' },
				{ hash: B, imdbId: 'tt0000003', verdict: 'trash' },
			])
		).toEqual([]);
	});

	it('comes after every mapping table, so a kept mapping still wins', () => {
		const verdicts = [
			{ hash: A, imdbId: 'tt0000001', verdict: 'keep' },
			{ hash: A, imdbId: 'tt0000002', verdict: 'keep' },
			{ hash: B, imdbId: 'tt0000003', verdict: 'keep' },
		];
		const picks = pickHashImdbIds(
			[[{ hash: A, imdbId: 'tt0000002' }], soleKeeps(verdicts)],
			verdicts
		);
		expect(picks.get(A)).toBe('tt0000002');
		expect(picks.get(B)).toBe('tt0000003');
	});
});

describe('getImdbSeries', () => {
	it("lists a series' episodes with IMDb's own titles, a season-less one kept as such", async () => {
		// dmmdb's rows for Dragon Ball Z Abridged (tt10710138), 2026-10-23
		prismaMock.imdbTitleBasics.findUnique.mockResolvedValue({
			titleType: 'tvSeries',
			primaryTitle: 'Dragon Ball Z Abridged',
		});
		prismaMock.imdbTitleEpisode.findMany.mockResolvedValue([
			{ tconst: 'tt1', seasonNumber: 2, episodeNumber: 15 },
			{ tconst: 'tt2', seasonNumber: null, episodeNumber: null },
		]);
		prismaMock.imdbTitleBasics.findMany.mockResolvedValue([
			{ tconst: 'tt1', primaryTitle: 'Nail is Piccolo, and so can you!' },
			{ tconst: 'tt2', primaryTitle: 'Dead Zone' },
		]);
		expect(await new HashImdbService().getImdbSeries('tt10710138')).toEqual({
			titleType: 'tvSeries',
			title: 'Dragon Ball Z Abridged',
			episodes: [
				{ season: 2, episode: 15, name: 'Nail is Piccolo, and so can you!' },
				{ season: null, episode: null, name: 'Dead Zone' },
			],
		});
	});

	it('answers null for a title IMDb does not have', async () => {
		prismaMock.imdbTitleBasics.findUnique.mockResolvedValue(null);
		expect(await new HashImdbService().getImdbSeries('tt0000000')).toBeNull();
	});
});
