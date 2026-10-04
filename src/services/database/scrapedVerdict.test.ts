import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pairKeyOf, ScrapedVerdictService, titleKeyOf } from './scrapedVerdict';

const tx = vi.hoisted(() => ({
	$queryRaw: vi.fn(),
	$executeRaw: vi.fn(),
	scrapedTrash: { createMany: vi.fn(), deleteMany: vi.fn() },
	scrapedVerdict: { deleteMany: vi.fn() },
}));

const prismaMock = vi.hoisted(() => ({
	imdbTitleBasics: { findUnique: vi.fn() },
	imdbTitleAkas: { findMany: vi.fn() },
	scrapedTrue: { findUnique: vi.fn() },
	scraped: { findUnique: vi.fn() },
	scrapedVerdict: { findMany: vi.fn(), createMany: vi.fn() },
	scrapedTrash: { findMany: vi.fn() },
	cache: {
		findUnique: vi.fn(),
		upsert: vi.fn(),
		create: vi.fn(),
		updateMany: vi.fn(),
		deleteMany: vi.fn(),
	},
	$queryRaw: vi.fn(),
	$executeRaw: vi.fn(),
	$transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

const sqlText = (query: Prisma.Sql) => query.strings.join('?');

describe('ScrapedVerdictService', () => {
	let service: ScrapedVerdictService;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new ScrapedVerdictService();
	});

	describe('getMovieContext', () => {
		it('collects every title and flags aliases that are another work’s primary title', async () => {
			prismaMock.imdbTitleBasics.findUnique.mockResolvedValue({
				primaryTitle: 'The Ministry of Ungentlemanly Warfare',
				originalTitle: 'The Ministry of Ungentlemanly Warfare',
				startYear: 2024,
				titleType: 'movie',
			});
			prismaMock.imdbTitleAkas.findMany.mockResolvedValue([
				{ title: 'Your Lucky Day' },
				{ title: 'Guerra sin reglas' },
				{ title: 'Guerra Sin Reglas' },
				{ title: null },
			]);
			prismaMock.$queryRaw.mockResolvedValue([
				{ primary_title: 'Your Lucky Day', start_year: 2023 },
				{ primary_title: 'Your Lucky Day', start_year: 2010 },
				{ primary_title: "It's Your Lucky Day", start_year: 2023 },
				// The movie's own primary title on another work is not ambiguity.
				{ primary_title: 'The Ministry of Ungentlemanly Warfare', start_year: 1999 },
			]);

			const context = await service.getMovieContext('tt5177120');

			expect(context).toEqual({
				imdbId: 'tt5177120',
				name: 'The Ministry of Ungentlemanly Warfare',
				year: 2024,
				titles: [
					'Guerra Sin Reglas',
					'The Ministry of Ungentlemanly Warfare',
					'Your Lucky Day',
				],
				ambiguous: { 'your lucky day': [2010, 2023] },
			});
			const query = prismaMock.$queryRaw.mock.calls[0][0] as Prisma.Sql;
			expect(sqlText(query)).toContain('MATCH(primary_title) AGAINST(? IN BOOLEAN MODE)');
			expect(query.values[0]).toBe(
				'"Guerra Sin Reglas" "The Ministry of Ungentlemanly Warfare" "Your Lucky Day"'
			);
		});

		it('leaves a series alone even when its episodes sit under a movie key', async () => {
			prismaMock.imdbTitleBasics.findUnique.mockResolvedValue({
				primaryTitle: 'Love Island: All Stars',
				originalTitle: 'Love Island: All Stars',
				startYear: 2024,
				titleType: 'tvSeries',
			});
			await expect(service.getMovieContext('tt28959685')).resolves.toBeNull();
			expect(prismaMock.imdbTitleAkas.findMany).not.toHaveBeenCalled();
		});

		it('does not count a video game sharing the name as another work', async () => {
			prismaMock.imdbTitleBasics.findUnique.mockResolvedValue({
				primaryTitle: 'Pirates of the Caribbean: The Curse of the Black Pearl',
				originalTitle: null,
				startYear: 2003,
				titleType: 'movie',
			});
			prismaMock.imdbTitleAkas.findMany.mockResolvedValue([
				{ title: 'Pirates of the Caribbean' },
			]);
			prismaMock.$queryRaw.mockResolvedValue([]);
			await service.getMovieContext('tt0325980');
			const query = prismaMock.$queryRaw.mock.calls[0][0] as Prisma.Sql;
			expect(sqlText(query)).toContain("title_type NOT IN ('tvEpisode', 'videoGame')");
		});

		it('returns null when IMDb has no year for the title', async () => {
			prismaMock.imdbTitleBasics.findUnique.mockResolvedValue({
				primaryTitle: 'Untitled',
				originalTitle: null,
				startYear: null,
			});
			await expect(service.getMovieContext('tt1')).resolves.toBeNull();
		});
	});

	describe('getStoredPairs', () => {
		it('reads both tables whole and reports the later change', async () => {
			prismaMock.scrapedTrue.findUnique.mockResolvedValue({
				value: [{ hash: 'ABC', title: 'A', fileSize: 100 }],
				updatedAt: new Date('2026-09-01'),
			});
			prismaMock.scraped.findUnique.mockResolvedValue({
				value: [{ hash: 'def', title: 'B' }, { title: 'no hash' }],
				updatedAt: new Date('2026-09-20'),
			});
			await expect(service.getStoredPairs('movie:tt1')).resolves.toEqual({
				pairs: [
					{ source: 'ScrapedTrue', hash: 'abc', title: 'A', fileSize: 100 },
					{ source: 'Scraped', hash: 'def', title: 'B', fileSize: null },
				],
				lastChanged: new Date('2026-09-20'),
			});
		});
	});

	describe('trashPairs', () => {
		it('moves only the matching entries and preserves the row’s updatedAt', async () => {
			const refreshed = new Date('2026-08-01T10:00:00.000Z');
			tx.$queryRaw.mockResolvedValue([
				{
					value: [
						{ hash: 'keep1', title: 'The Movie 2024', fileSize: 5 },
						{ hash: 'JUNK1', title: 'Other Film 2011', fileSize: 7 },
						// Same hash under another filename was not judged trash.
						{ hash: 'junk1', title: 'The Movie 2024 REPACK', fileSize: 7 },
					],
					updatedAt: refreshed,
				},
			]);

			const removed = await service.trashPairs(
				'movie:tt1',
				{ imdbId: 'tt1', name: 'The Movie' },
				[
					{
						source: 'Scraped',
						hash: 'junk1',
						title: 'Other Film 2011',
						fileSize: 7,
						rule: 'jev',
					},
				],
				'rules-v6+jev/jev-1.13.0'
			);

			expect(removed).toBe(1);
			expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
			expect(sqlText(tx.$queryRaw.mock.calls[0][0])).toContain('FROM `Scraped`');
			expect(sqlText(tx.$queryRaw.mock.calls[0][0])).toContain('FOR UPDATE');
			const update = tx.$executeRaw.mock.calls[0][0] as Prisma.Sql;
			expect(sqlText(update)).toContain('UPDATE `Scraped` SET value = ?, updatedAt = ?');
			expect(JSON.parse(update.values[0] as string)).toEqual([
				{ hash: 'keep1', title: 'The Movie 2024', fileSize: 5 },
				{ hash: 'junk1', title: 'The Movie 2024 REPACK', fileSize: 7 },
			]);
			expect(update.values[1]).toBe(refreshed);
			expect(tx.scrapedTrash.createMany).toHaveBeenCalledWith({
				data: [
					{
						source: 'Scraped',
						key: 'movie:tt1',
						imdbId: 'tt1',
						movieTitle: 'The Movie',
						hash: 'junk1',
						title: 'Other Film 2011',
						fileSize: 7,
						rule: 'jev',
						engine: 'rules-v6+jev/jev-1.13.0',
					},
				],
			});
		});

		it('writes nothing when the entries are already gone', async () => {
			tx.$queryRaw.mockResolvedValue([{ value: [], updatedAt: new Date() }]);
			const removed = await service.trashPairs(
				'movie:tt1',
				{ imdbId: 'tt1', name: 'The Movie' },
				[{ source: 'ScrapedTrue', hash: 'x', title: 'y', fileSize: null, rule: 'rules' }],
				'e'
			);
			expect(removed).toBe(0);
			expect(tx.$executeRaw).not.toHaveBeenCalled();
			expect(tx.scrapedTrash.createMany).not.toHaveBeenCalled();
		});
	});

	it('keys verdicts by lower-cased hash and a digest of the filename', async () => {
		await service.saveVerdicts([
			{
				imdbId: 'tt1',
				hash: 'ABC',
				title: 'Name',
				verdict: 'keep',
				rule: 'jev',
				media: 'FILM',
				titleMatch: 'SAME_TITLE',
				engine: 'e',
			},
		]);
		expect(prismaMock.scrapedVerdict.createMany).toHaveBeenCalledWith({
			data: [expect.objectContaining({ hash: 'abc', titleKey: titleKeyOf('Name') })],
			skipDuplicates: true,
		});
		prismaMock.scrapedVerdict.findMany.mockResolvedValue([
			{ hash: 'ABC', titleKey: titleKeyOf('Name') },
		]);
		const keys = await service.getTrashedPairKeys('tt1', ['ABC', 'abc']);
		expect(keys.has(pairKeyOf('abc', 'Name'))).toBe(true);
		expect(prismaMock.scrapedVerdict.findMany.mock.calls[0][0].where.hash).toEqual({
			in: ['abc'],
		});
	});

	describe('restoreTrash', () => {
		it('puts entries back without touching updatedAt and forgets their verdicts', async () => {
			const refreshed = new Date('2026-09-21T14:41:34.273Z');
			prismaMock.scrapedTrash.findMany.mockResolvedValue([
				{
					id: 7,
					source: 'Scraped',
					key: 'movie:tt3498820',
					imdbId: 'tt3498820',
					hash: 'aaa',
					title: 'Captain.America.Civil.War.HDR.1080p.HEVC.10bit.BT.2020.DTS-HD.MA',
					fileSize: 20000,
				},
				{
					id: 8,
					source: 'Scraped',
					key: 'movie:tt3498820',
					imdbId: 'tt3498820',
					hash: 'bbb',
					title: 'Already written back by a scraper',
					fileSize: 10,
				},
			]);
			tx.$queryRaw.mockResolvedValue([
				{
					value: [
						{ hash: 'BBB', title: 'Already written back by a scraper', fileSize: 10 },
					],
					updatedAt: refreshed,
				},
			]);

			await expect(service.restoreTrash([7, 8])).resolves.toBe(1);

			const update = tx.$executeRaw.mock.calls[0][0] as Prisma.Sql;
			expect(sqlText(update)).toContain('UPDATE `Scraped` SET value = ?, updatedAt = ?');
			expect(JSON.parse(update.values[0] as string)).toEqual([
				{ hash: 'BBB', title: 'Already written back by a scraper', fileSize: 10 },
				{
					hash: 'aaa',
					title: 'Captain.America.Civil.War.HDR.1080p.HEVC.10bit.BT.2020.DTS-HD.MA',
					fileSize: 20000,
				},
			]);
			expect(update.values[1]).toBe(refreshed);
			expect(tx.scrapedTrash.deleteMany).toHaveBeenCalledWith({
				where: { id: { in: [7, 8] } },
			});
			// One statement for the whole page: a row-by-row delete held the
			// transaction past its timeout on a 967-entry page (tt28959685).
			expect(tx.scrapedVerdict.deleteMany).toHaveBeenCalledTimes(1);
			expect(tx.scrapedVerdict.deleteMany).toHaveBeenCalledWith({
				where: {
					OR: [
						{
							imdbId: 'tt3498820',
							hash: 'aaa',
							titleKey: titleKeyOf(
								'Captain.America.Civil.War.HDR.1080p.HEVC.10bit.BT.2020.DTS-HD.MA'
							),
						},
						{
							imdbId: 'tt3498820',
							hash: 'bbb',
							titleKey: titleKeyOf('Already written back by a scraper'),
						},
					],
				},
			});
		});
	});

	it('counts spend in one shared row per UTC day', async () => {
		prismaMock.cache.findUnique.mockResolvedValue({ value: { tokens: 2468.0 } });
		await expect(service.getTokensSpent('2026-09-27')).resolves.toBe(2468);
		expect(prismaMock.cache.findUnique).toHaveBeenCalledWith({
			where: { key: 'verdicts:tokens:2026-09-27' },
		});

		await service.addTokensSpent('2026-09-27', 1234);
		const upsert = prismaMock.$executeRaw.mock.calls[0][0] as Prisma.Sql;
		expect(sqlText(upsert)).toContain('ON DUPLICATE KEY UPDATE');
		expect(upsert.values).toEqual(['verdicts:tokens:2026-09-27', 1234, 1234]);

		await service.addTokensSpent('2026-09-27', 0);
		expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
	});

	describe('acquireLock', () => {
		const taken = new Prisma.PrismaClientKnownRequestError('dup', {
			code: 'P2002',
			clientVersion: 'test',
		});

		it('takes a free lock', async () => {
			prismaMock.cache.create.mockResolvedValue({});
			await expect(service.acquireLock('movie:tt1', 1000)).resolves.toBe(true);
		});

		it('refuses a live lock and takes over a stale one', async () => {
			prismaMock.cache.create.mockRejectedValue(taken);
			prismaMock.cache.updateMany.mockResolvedValueOnce({ count: 0 });
			await expect(service.acquireLock('movie:tt1', 1000)).resolves.toBe(false);
			prismaMock.cache.updateMany.mockResolvedValueOnce({ count: 1 });
			await expect(service.acquireLock('movie:tt1', 1000)).resolves.toBe(true);
			expect(prismaMock.cache.updateMany.mock.calls[0][0].where.key).toBe(
				'verdicts:lock:movie:tt1'
			);
		});
	});

	describe('the written-back trash sweep', () => {
		it('reads movie pages changed after the cursor, oldest first, ties broken by key', async () => {
			prismaMock.$queryRaw.mockResolvedValue([
				{ key: 'movie:tt1', updatedAt: new Date('2026-10-02T00:00:00Z') },
			]);
			const after = { key: 'movie:tt0', at: new Date('2026-10-01T00:00:00Z') };
			const settled = new Date('2026-10-04T00:00:00Z');

			await expect(
				service.getChangedMoviePages('ScrapedTrue', after, settled, 200)
			).resolves.toEqual([{ key: 'movie:tt1', at: new Date('2026-10-02T00:00:00Z') }]);

			const query = prismaMock.$queryRaw.mock.calls[0][0] as Prisma.Sql;
			const sql = sqlText(query).replace(/\s+/g, ' ');
			expect(sql).toContain('FROM `ScrapedTrue`');
			expect(sql).toContain("`key` LIKE 'movie:tt%'");
			expect(sql).toContain('(updatedAt > ? OR (updatedAt = ? AND `key` > ?))');
			expect(sql).toContain('updatedAt <= ?');
			expect(sql).toContain('ORDER BY updatedAt, `key` LIMIT ?');
			expect(query.values).toEqual([after.at, after.at, after.key, settled, 200]);
		});

		it('asks which movies have verdicts from the index alone', async () => {
			prismaMock.$queryRaw.mockResolvedValue([{ imdbId: 'tt1' }]);
			await expect(service.getJudgedImdbIds(['tt1', 'tt2'])).resolves.toEqual(
				new Set(['tt1'])
			);
			const query = prismaMock.$queryRaw.mock.calls[0][0] as Prisma.Sql;
			expect(sqlText(query).replace(/\s+/g, ' ')).toContain('GROUP BY imdbId');
			expect(query.values).toEqual(['tt1', 'tt2']);

			prismaMock.$queryRaw.mockClear();
			await expect(service.getJudgedImdbIds([])).resolves.toEqual(new Set());
			expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
		});

		it('keeps its cursor in the Cache table and ignores one it cannot read', async () => {
			const cursor = { key: 'movie:tt1', at: new Date('2026-10-02T12:33:05.655Z') };
			await service.setSweepCursor('Scraped', cursor);
			const { where, create } = prismaMock.cache.upsert.mock.calls[0][0];
			expect(where.key).toBe('verdicts:sweep:Scraped');
			expect(create.value).toEqual({ key: 'movie:tt1', at: '2026-10-02T12:33:05.655Z' });

			prismaMock.cache.findUnique.mockResolvedValueOnce({ value: create.value });
			await expect(service.getSweepCursor('Scraped')).resolves.toEqual(cursor);
			prismaMock.cache.findUnique.mockResolvedValueOnce({ value: { at: 7 } });
			await expect(service.getSweepCursor('Scraped')).resolves.toBeNull();
			prismaMock.cache.findUnique.mockResolvedValueOnce(null);
			await expect(service.getSweepCursor('Scraped')).resolves.toBeNull();
		});
	});
});
