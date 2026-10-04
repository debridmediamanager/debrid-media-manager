import { MAX_SIZE_MB } from '@/utils/releaseSize';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
	FAN_OUT_PAGE_LIMIT,
	isPageWriteConflict,
	PAGE_SAVE_ATTEMPTS,
	ScrapedService,
} from './scraped';

const prismaMock = vi.hoisted(() => ({
	scrapedTrue: {
		findUnique: vi.fn(),
		update: vi.fn(),
		create: vi.fn(),
		findMany: vi.fn(),
	},
	scraped: {
		findUnique: vi.fn(),
		findFirst: vi.fn(),
		findMany: vi.fn(),
		update: vi.fn(),
		create: vi.fn(),
		deleteMany: vi.fn(),
	},
	hashPageCount: {
		findMany: vi.fn(),
	},
	$queryRaw: vi.fn(),
	$transaction: vi.fn(),
}));

// What a save sees inside its transaction: the locked read and the write.
const txMock = vi.hoisted(() => ({
	$queryRaw: vi.fn(),
	$executeRaw: vi.fn(),
}));

const { flattenAndRemoveDuplicatesMock, sortByFileSizeMock } = vi.hoisted(() => ({
	flattenAndRemoveDuplicatesMock: vi.fn((value: any) => value.flat()),
	sortByFileSizeMock: vi.fn((value: any) => value),
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

// Partial mock: only the two helpers below are stubbed, so genuinely pure
// helpers like isUsableHash keep their real behaviour and a new export here
// does not break every test in this file.
vi.mock('../mediasearch', async (importOriginal) => ({
	...(await importOriginal<typeof import('../mediasearch')>()),
	flattenAndRemoveDuplicates: flattenAndRemoveDuplicatesMock,
	sortByFileSize: sortByFileSizeMock,
}));

// Both save paths now drop entries whose hash could never name a torrent, so
// these fixtures have to look like real infohashes rather than placeholders.
const HASH_ONE = 'a'.repeat(40);
const HASH_TWO = 'b'.repeat(40);
const HASH_NEW = 'c'.repeat(40);

const STORED_AT = new Date('2024-01-01');

/** The page row the locked read finds, or none. */
const storedPage = (value: unknown[] | null) =>
	txMock.$queryRaw.mockResolvedValue(value ? [{ value, updatedAt: STORED_AT }] : []);

/** The last write a save made: its statement and the array it stored. */
const lastWrite = () => {
	const query = txMock.$executeRaw.mock.calls.at(-1)![0] as Prisma.Sql;
	const json = query.values.find((v) => typeof v === 'string' && v.startsWith('['));
	return {
		sql: query.sql.replace(/\s+/g, ' '),
		values: query.values,
		value: JSON.parse(json as string),
	};
};

const mysqlError = (code: string) =>
	new Prisma.PrismaClientKnownRequestError(`Raw query failed. Code: \`${code}\``, {
		code: 'P2010',
		clientVersion: 'test',
		meta: { code, message: 'recorded shape' },
	});

describe('ScrapedService', () => {
	let service: ScrapedService;

	beforeEach(() => {
		service = new ScrapedService();
		Object.values(prismaMock.scrapedTrue).forEach((fn) => (fn as Mock).mockReset());
		Object.values(prismaMock.scraped).forEach((fn) => (fn as Mock).mockReset());
		(prismaMock.$queryRaw as Mock).mockReset();
		(prismaMock.hashPageCount.findMany as Mock).mockReset();
		// Default: nothing is known to be over-shared, so saves pass through.
		(prismaMock.hashPageCount.findMany as Mock).mockResolvedValue([]);
		txMock.$queryRaw.mockReset();
		txMock.$executeRaw.mockReset().mockResolvedValue(1);
		prismaMock.$transaction.mockReset().mockImplementation(async (fn: any) => fn(txMock));
		flattenAndRemoveDuplicatesMock.mockClear();
		sortByFileSizeMock.mockClear();
	});

	it('returns scraped true results via raw query', async () => {
		const rows = [{ value: [{ hash: 'hash-1' }] }];
		prismaMock.$queryRaw.mockResolvedValue(rows);

		const results = await service.getScrapedTrueResults('key');
		expect(prismaMock.$queryRaw).toHaveBeenCalled();
		expect(results).toEqual(rows[0].value);
	});

	// Live row movie:tt5325452 on 2026-10-03: the uindex spider stored a "29 TB"
	// banner ad as the size of `Boo A Madea Halloween 2016 1080p AMZN WEB-DL DDP5
	// 1 H 264-GPRS` (e211a5f0…, really 7535.6 MB), so it led the page at
	// 28,320 GB. Run against production, the query below reports it as 0 and the
	// 36,792 MB Blu-rays lead instead.
	it.each([
		['getScrapedTrueResults', 'ScrapedTrue'],
		['getScrapedResults', 'Scraped'],
	] as const)('%s reports a size above the noise ceiling as unknown', async (method, table) => {
		prismaMock.$queryRaw.mockResolvedValue([{ value: [] }]);

		await service[method]('movie:tt5325452', 30);

		const query = (prismaMock.$queryRaw as Mock).mock.calls[0][0] as Prisma.Sql;
		const sql = query.sql.replace(/\s+/g, ' ');
		const capped = 'CASE WHEN jt.fileSize > ? THEN 0 ELSE jt.fileSize END';
		expect(sql).toContain(`FROM ${table} s`);
		expect(sql).toContain(`${capped} AS fileSize`);
		expect(sql).toContain(`ORDER BY ${capped} DESC`);
		expect(sql).toContain(`AND ${capped} <= ?`);
		expect(sql).not.toMatch(/ORDER BY jt\.fileSize/);
		expect(query.values).toContain(MAX_SIZE_MB);
	});

	it('validates inputs in query helpers', async () => {
		await expect(service.getScrapedTrueResults('', 1)).rejects.toThrow('Invalid key');
		await expect(service.getScrapedResults('key', -1)).rejects.toThrow(
			'maxSizeGB must be a positive number.'
		);
	});

	it('merges and sorts scrapedTrue results when updating without replacement', async () => {
		storedPage([{ hash: HASH_ONE }]);
		flattenAndRemoveDuplicatesMock.mockReturnValue([[{ hash: HASH_ONE }, { hash: HASH_TWO }]]);
		sortByFileSizeMock.mockReturnValue([{ hash: HASH_ONE }, { hash: HASH_TWO }]);

		await service.saveScrapedTrueResults('key', [{ hash: HASH_TWO }] as any);

		expect(flattenAndRemoveDuplicatesMock).toHaveBeenCalledWith([
			[{ hash: HASH_ONE }],
			[{ hash: HASH_TWO }],
		]);
		expect(lastWrite().sql).toContain('UPDATE `ScrapedTrue` SET value = ?, updatedAt = ?');
		expect(lastWrite().value).toEqual([{ hash: HASH_ONE }, { hash: HASH_TWO }]);
	});

	// 1,167 of 4,835 filed nzb2rd releases were on no page of their title on
	// 2026-10-04: two writers read the same array and each wrote it back with
	// only its own release. The read has to lock the row, inside the
	// transaction that writes it.
	it.each([
		['saveScrapedTrueResults', 'ScrapedTrue'],
		['saveScrapedResults', 'Scraped'],
	] as const)(
		'%s reads the page under its row lock and writes it in that transaction',
		async (method, table) => {
			storedPage([{ hash: HASH_ONE }]);

			await service[method]('tv:tt0837069:1', [{ hash: HASH_TWO }] as any);

			expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
			const read = txMock.$queryRaw.mock.calls[0][0] as Prisma.Sql;
			expect(read.sql).toBe(
				`SELECT value, updatedAt FROM \`${table}\` WHERE \`key\` = ? FOR UPDATE`
			);
			expect(read.values).toEqual(['tv:tt0837069:1']);
			expect(lastWrite().sql).toContain(`UPDATE \`${table}\``);
			expect(lastWrite().values.at(-1)).toBe('tv:tt0837069:1');
			// Nothing outside the transaction reads or writes the page.
			expect(prismaMock.scrapedTrue.findUnique).not.toHaveBeenCalled();
			expect(prismaMock.scraped.findUnique).not.toHaveBeenCalled();
			expect(prismaMock.scrapedTrue.update).not.toHaveBeenCalled();
			expect(prismaMock.scraped.update).not.toHaveBeenCalled();
		}
	);

	it('keeps the page date when told not to touch it, and dates it now otherwise', async () => {
		storedPage([{ hash: HASH_ONE }]);
		await service.saveScrapedTrueResults('key', [{ hash: HASH_TWO }] as any, false);
		expect(lastWrite().values).toContain(STORED_AT);

		const before = Date.now();
		await service.saveScrapedTrueResults('key', [{ hash: HASH_TWO }] as any, true);
		const date = lastWrite().values.find((v) => v instanceof Date) as Date;
		expect(date).not.toBe(STORED_AT);
		expect(date.getTime()).toBeGreaterThanOrEqual(before);
	});

	it('replaces scrapedTrue values when flag is set', async () => {
		storedPage([{ hash: HASH_ONE }]);

		await service.saveScrapedTrueResults('key', [{ hash: HASH_NEW }] as any, true, true);

		expect(flattenAndRemoveDuplicatesMock).not.toHaveBeenCalled();
		expect(lastWrite().sql).toContain('UPDATE `ScrapedTrue`');
		expect(lastWrite().value).toEqual([{ hash: HASH_NEW }]);
	});

	it('creates scrapedTrue rows when none exist', async () => {
		storedPage(null);

		await service.saveScrapedTrueResults('key', [{ hash: HASH_ONE }] as any);

		expect(lastWrite().sql).toBe(
			'INSERT INTO `ScrapedTrue` (`key`, value, updatedAt) VALUES (?, ?, ?)'
		);
		expect(lastWrite().values[0]).toBe('key');
		expect(lastWrite().value).toEqual([{ hash: HASH_ONE }]);
	});

	it('persists scraped results using the same flows', async () => {
		storedPage([{ hash: HASH_ONE }]);

		await service.saveScrapedResults('key', [{ hash: HASH_ONE }] as any, false, true);

		expect(lastWrite().sql).toContain('UPDATE `Scraped` SET');
		expect(lastWrite().value).toEqual([{ hash: HASH_ONE }]);
	});

	it('drops unusable hashes on the replace and create paths', async () => {
		// These two branches write what they are handed instead of going through
		// flattenAndRemoveDuplicates, so they were the way sha1("") reached the
		// table on 2110 pages.
		const emptySha1 = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';

		storedPage([{ hash: HASH_ONE }]);
		await service.saveScrapedTrueResults(
			'key',
			[{ hash: HASH_NEW }, { hash: emptySha1 }, { hash: 'not-a-hash' }] as any,
			true,
			true
		);
		expect(lastWrite().value).toEqual([{ hash: HASH_NEW }]);

		storedPage(null);
		await service.saveScrapedResults('key', [{ hash: emptySha1 }, { hash: HASH_TWO }] as any);
		expect(lastWrite().sql).toContain('INSERT INTO `Scraped`');
		expect(lastWrite().value).toEqual([{ hash: HASH_TWO }]);
	});

	it('drops hashes already spread across too many pages', async () => {
		const fannedOut = 'd'.repeat(40);
		(prismaMock.hashPageCount.findMany as Mock).mockResolvedValue([
			{ hash: fannedOut, pageCount: FAN_OUT_PAGE_LIMIT + 1 },
			{ hash: HASH_ONE, pageCount: FAN_OUT_PAGE_LIMIT },
		]);
		storedPage(null);

		await service.saveScrapedTrueResults('key', [
			{ hash: HASH_ONE },
			{ hash: fannedOut },
			{ hash: HASH_TWO },
		] as any);

		// HASH_ONE sits exactly at the limit and HASH_TWO is unknown to the
		// table, so only the one past the limit is dropped.
		expect(lastWrite().value).toEqual([{ hash: HASH_ONE }, { hash: HASH_TWO }]);
	});

	it('matches over-shared hashes regardless of case', async () => {
		// HashPageCount.hash collates case-insensitively, so a stored row can come
		// back in different case than the incoming result.
		(prismaMock.hashPageCount.findMany as Mock).mockResolvedValue([
			{ hash: 'C'.repeat(40), pageCount: 900 },
		]);
		storedPage(null);

		await service.saveScrapedResults('key', [{ hash: HASH_NEW }, { hash: HASH_TWO }] as any);

		expect(lastWrite().value).toEqual([{ hash: HASH_TWO }]);
	});

	it('decodes entity-encoded titles on the direct write paths', async () => {
		// The create and replace branches skip flattenAndRemoveDuplicates, so
		// without this they would keep storing raw entities.
		storedPage(null);

		await service.saveScrapedResults('key', [
			{ hash: HASH_ONE, title: 'Grandma&#039;s Boy', fileSize: 1 },
		] as any);

		expect(lastWrite().value).toEqual([
			{ hash: HASH_ONE, title: "Grandma's Boy", fileSize: 1 },
		]);
	});

	// The shapes Prisma 6 gave on MySQL 8.0.36 for a raw query in an interactive
	// transaction, measured 2026-10-04.
	it('tells another writer winning the page apart from other failures', () => {
		expect(isPageWriteConflict(mysqlError('1213'))).toBe(true); // deadlock victim
		expect(isPageWriteConflict(mysqlError('1062'))).toBe(true); // both created the page
		expect(isPageWriteConflict(mysqlError('1205'))).toBe(true); // lock wait timeout
		expect(isPageWriteConflict(mysqlError('1406'))).toBe(false);
		expect(
			isPageWriteConflict(
				new Prisma.PrismaClientKnownRequestError('expired', {
					code: 'P2028',
					clientVersion: 'test',
				})
			)
		).toBe(false);
		expect(isPageWriteConflict(new Error('Deadlock found'))).toBe(false);
	});

	it('runs the save again when another writer wins the page', async () => {
		storedPage([{ hash: HASH_ONE }]);
		prismaMock.$transaction
			.mockRejectedValueOnce(mysqlError('1213'))
			.mockRejectedValueOnce(mysqlError('1062'));

		await service.saveScrapedTrueResults('key', [{ hash: HASH_TWO }] as any);

		expect(prismaMock.$transaction).toHaveBeenCalledTimes(3);
		expect(lastWrite().sql).toContain('UPDATE `ScrapedTrue`');
	});

	it('gives up after its attempts, and at once on anything else', async () => {
		prismaMock.$transaction.mockRejectedValue(mysqlError('1213'));
		await expect(
			service.saveScrapedTrueResults('key', [{ hash: HASH_TWO }] as any)
		).rejects.toThrow('1213');
		expect(prismaMock.$transaction).toHaveBeenCalledTimes(PAGE_SAVE_ATTEMPTS);

		prismaMock.$transaction.mockReset().mockRejectedValue(new Error('connection lost'));
		await expect(
			service.saveScrapedTrueResults('key', [{ hash: HASH_TWO }] as any)
		).rejects.toThrow('connection lost');
		expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

		// A failed save does not hold up the next one on that page.
		prismaMock.$transaction.mockReset().mockImplementation(async (fn: any) => fn(txMock));
		storedPage(null);
		await service.saveScrapedTrueResults('key', [{ hash: HASH_TWO }] as any);
		expect(lastWrite().sql).toContain('INSERT INTO `ScrapedTrue`');
	});

	// A Transfers poll files every completed row of a page at once: 25 episodes
	// of one season on 2026-09-07. Each locked save holds a pooled connection
	// while it waits, so one process queues its own saves to a page instead.
	it('runs this process’s saves to one page one at a time, and other pages alongside', async () => {
		storedPage([{ hash: HASH_ONE }]);
		const events: string[] = [];
		const releases: Array<() => void> = [];
		prismaMock.$transaction.mockImplementation(async (fn: any) => {
			const n = events.filter((e) => e.startsWith('start')).length;
			events.push(`start ${n}`);
			await new Promise<void>((resolve) => releases.push(resolve));
			await fn(txMock);
			events.push(`end ${n}`);
		});

		const saves = [
			service.saveScrapedTrueResults('tv:tt0837069:1', [{ hash: HASH_TWO }] as any),
			service.saveScrapedTrueResults('tv:tt0837069:1', [{ hash: HASH_NEW }] as any),
			service.saveScrapedTrueResults('tv:tt0074049:1', [{ hash: HASH_NEW }] as any),
		];
		await vi.waitFor(() => expect(releases).toHaveLength(2));
		// The first save to each page started; the second to the same page waits.
		expect(events).toEqual(['start 0', 'start 1']);

		releases[0]();
		await vi.waitFor(() => expect(releases).toHaveLength(3));
		expect(events).toEqual(['start 0', 'start 1', 'end 0', 'start 2']);
		releases[1]();
		releases[2]();
		await Promise.all(saves);
	});

	it('checks key existence and age computations', async () => {
		prismaMock.scraped.findFirst.mockResolvedValueOnce({ key: 'key' });
		expect(await service.keyExists('key')).toBe(true);

		prismaMock.scraped.findFirst
			.mockResolvedValueOnce({ updatedAt: new Date(Date.now() - 10 * 86400000) })
			.mockResolvedValueOnce({ updatedAt: new Date() });

		expect(await service.isOlderThan('tt1', 1)).toBe(true);
		expect(await service.isOlderThan('tt1', 1)).toBe(false);
	});

	it('returns metadata for queued and processing requests', async () => {
		prismaMock.scraped.findFirst.mockResolvedValueOnce({
			key: 'requested:tt1234567',
			updatedAt: new Date('2024-01-01'),
		});
		const oldest = await service.getOldestRequest();
		expect(oldest).toEqual({ key: 'tt1234567', updatedAt: new Date('2024-01-01') });

		prismaMock.scraped.findFirst.mockResolvedValueOnce({
			key: 'processing:tt999',
			updatedAt: new Date('2024-01-01'),
		});
		prismaMock.scraped.update.mockResolvedValue(undefined);
		expect(await service.processingMoreThanAnHour()).toBe('tt999');
		expect(prismaMock.scraped.update).toHaveBeenCalled();
	});

	it('lists scraped media and imdb ids', async () => {
		prismaMock.scraped.findMany.mockResolvedValueOnce([{ key: 'tv:tt1' }, { key: 'tv:tt2' }]);
		expect(await service.getOldestScrapedMedia('tv', 2)).toEqual(['tt1', 'tt2']);

		prismaMock.scraped.findMany.mockResolvedValueOnce([
			{ key: 'movie:tt1' },
			{ key: 'movie:tt1' },
			{ key: 'movie:tt2' },
		]);
		expect(await service.getAllImdbIds('movie')).toEqual(['tt1', 'tt2']);
	});

	it('removes processed requests', async () => {
		await service.markAsDone('tt1');
		expect(prismaMock.scraped.deleteMany).toHaveBeenCalledTimes(2);
	});

	it('merges recently updated scraped content', async () => {
		const now = new Date();
		prismaMock.scraped.findMany.mockResolvedValueOnce([{ key: 'movie:tt1', updatedAt: now }]);
		prismaMock.scrapedTrue.findMany.mockResolvedValueOnce([
			{ key: 'tv:tt2', updatedAt: new Date(now.getTime() - 1000) },
		]);

		const recent = await service.getRecentlyUpdatedContent();
		expect(recent).toEqual(['movie:tt1', 'tv:tt2']);
	});

	it('returns a library page with the timestamp the feed dates it from', async () => {
		const updatedAt = new Date('2026-02-01T10:00:00Z');
		prismaMock.scrapedTrue.findUnique.mockResolvedValueOnce({
			key: 'movie:tt1',
			value: [{ title: 'x', fileSize: 1, hash: HASH_ONE }],
			updatedAt,
		});

		expect(await service.getScrapedTrueRow('movie:tt1')).toEqual({
			results: [{ title: 'x', fileSize: 1, hash: HASH_ONE }],
			updatedAt,
		});
		expect(await service.getScrapedTrueRow('movie:missing')).toBeNull();
	});

	// Ordering by season number would answer a show's search with its junk pages:
	// tt0903747 had season keys up to 72 on 2026-09-06, while its five real
	// seasons were the five most recently refreshed.
	it('lists season pages in refresh order, not by season number', async () => {
		prismaMock.scrapedTrue.findMany.mockResolvedValueOnce([
			{ key: 'tv:tt1:5' },
			{ key: 'tv:tt1:72' },
			{ key: 'tv:tt1:1' },
		]);

		expect(await service.getScrapedTrueSeasonKeys('tt1')).toEqual([
			'tv:tt1:5',
			'tv:tt1:72',
			'tv:tt1:1',
		]);
		expect(prismaMock.scrapedTrue.findMany).toHaveBeenCalledWith({
			where: { key: { startsWith: 'tv:tt1:' } },
			orderBy: { updatedAt: 'desc' },
			select: { key: true },
		});
	});

	it('drops a key that is not a season page', async () => {
		prismaMock.scrapedTrue.findMany.mockResolvedValueOnce([
			{ key: 'tv:tt1:2' },
			{ key: 'tv:tt1:' },
			{ key: 'tv:tt1:2:extra' },
		]);

		expect(await service.getScrapedTrueSeasonKeys('tt1')).toEqual(['tv:tt1:2']);
	});

	it('returns recent library pages with their timestamps', async () => {
		const updatedAt = new Date('2026-02-01T10:00:00Z');
		prismaMock.scrapedTrue.findMany.mockResolvedValueOnce([{ key: 'movie:tt1', updatedAt }]);

		expect(await service.getRecentScrapedTrueKeys(8)).toEqual([
			{ key: 'movie:tt1', updatedAt },
		]);
		expect(prismaMock.scrapedTrue.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ take: 8, orderBy: { updatedAt: 'desc' } })
		);
	});

	it('returns cached counts from raw queries', async () => {
		prismaMock.$queryRaw
			.mockResolvedValueOnce([{ contentSize: BigInt(10) }])
			.mockResolvedValueOnce([{ processing: BigInt(2) }])
			.mockResolvedValueOnce([{ requested: BigInt(3) }]);

		expect(await service.getContentSize()).toBe(10);
		expect(await service.getProcessingCount()).toBe(2);
		expect(await service.getRequestedCount()).toBe(3);
	});
});
