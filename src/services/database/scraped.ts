import { MAX_SIZE_MB } from '@/utils/releaseSize';
import { Prisma } from '@prisma/client';
import {
	ScrapeSearchResult,
	decodeTitle,
	flattenAndRemoveDuplicates,
	isUsableHash,
	sortByFileSize,
} from '../mediasearch';
import { DatabaseClient } from './client';

/**
 * A stored size the library cannot mean, read as unknown. Scrapers have written
 * sizes in the wrong unit, and the uindex spider read a "29 TB" banner ad as the
 * size of thousands of releases, so `Boo A Madea Halloween 2016 1080p AMZN
 * WEB-DL DDP5 1 H 264-GPRS` (really 7.36 GB) was stored as 29,000,000 MB. The
 * pages sort biggest-first, so a row like that took the top of every page it was
 * on. Zero is what the page already treats as "size not known": the debrid
 * availability check fills it in from the real file list.
 */
// A function rather than a constant: building SQL at module load crashes every
// page in the browser bundle (see prisma-module-load.test.ts).
const plausibleFileSize = () =>
	Prisma.sql`CASE WHEN jt.fileSize > ${MAX_SIZE_MB} THEN 0 ELSE jt.fileSize END`;

/**
 * The append branch below launders results through flattenAndRemoveDuplicates,
 * but the replace and create branches write what they are handed. Both save
 * paths sanitise up front so no branch can be the one that lets a bad hash or an
 * entity-encoded title in.
 */
const usableResults = (value: ScrapeSearchResult[]): ScrapeSearchResult[] =>
	value
		.filter((r) => isUsableHash(r?.hash))
		.map((r) => {
			const title = decodeTitle(r.title);
			return title === r.title ? r : { ...r, title };
		});

/**
 * A hash spread across more distinct titles than this is matcher failure, not a
 * collection.
 *
 * The unit is titles, not page keys. TV keys carry a season (`tv:ttX:12`), so a
 * complete-series pack legitimately appears on every season page of its show -
 * counting page keys reported a 38-season run as 38-fold fan-out and a cleanup
 * built on that would have emptied hundreds of populated season pages.
 *
 * Measured over the whole corpus on the collapsed unit: 99.1% of hashes touch 5
 * titles or fewer and 99.7% touch 10 or fewer, while the worst reaches 14,503.
 * 25 leaves ordinary packs, double features and long-running shows well clear.
 */
export const FAN_OUT_PAGE_LIMIT = 25;

type PageTable = 'ScrapedTrue' | 'Scraped';

/**
 * Errors that mean another writer got to the page first, so the save runs
 * again and reads what that writer left. Raw queries report MySQL's code in
 * `meta` under P2010: a deadlock (1213), a lock wait timeout (1205), and the
 * duplicate key (1062) when two writers create the same new page. Prisma's own
 * operations call the first and last P2034 and P2002.
 */
const RETRIED_MYSQL_ERRORS = new Set(['1213', '1205', '1062']);
export const PAGE_SAVE_ATTEMPTS = 5;

export function isPageWriteConflict(error: unknown): boolean {
	if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
	if (error.code === 'P2034' || error.code === 'P2002') return true;
	const mysqlCode = (error.meta as { code?: unknown } | undefined)?.code;
	return error.code === 'P2010' && RETRIED_MYSQL_ERRORS.has(String(mysqlCode));
}

/**
 * This process's saves to one page, one after another.
 *
 * The row lock is what keeps two writers from losing each other's releases;
 * this only stops one replica parking a pooled connection per release on that
 * lock. A Transfers poll files every completed row of a page at once, which on
 * 2026-09-07 was 25 episodes of one season.
 */
const pageQueues = new Map<string, Promise<void>>();
function onePageAtATime<T>(page: string, task: () => Promise<T>): Promise<T> {
	const run = (pageQueues.get(page) ?? Promise.resolve()).then(task);
	const settled = run.then(
		() => undefined,
		() => undefined
	);
	pageQueues.set(page, settled);
	void settled.then(() => {
		if (pageQueues.get(page) === settled) pageQueues.delete(page);
	});
	return run;
}

export class ScrapedService extends DatabaseClient {
	/**
	 * Drops results whose hash is already spread across more pages than any real
	 * torrent could belong to. The counts come from HashPageCount, refreshed
	 * periodically rather than maintained per write - a hash drifting past the
	 * limit is caught on the next refresh, and a missing row simply means the
	 * hash is new and allowed.
	 */
	private async withoutFannedOutHashes(
		value: ScrapeSearchResult[]
	): Promise<ScrapeSearchResult[]> {
		if (value.length === 0) return value;

		const counts = await this.prisma.hashPageCount.findMany({
			where: { hash: { in: value.map((r) => r.hash) } },
			select: { hash: true, pageCount: true },
		});

		// The hash column collates case-insensitively, so what comes back can
		// differ in case from what went in.
		const overLimit = new Set(
			counts.filter((c) => c.pageCount > FAN_OUT_PAGE_LIMIT).map((c) => c.hash.toLowerCase())
		);
		if (overLimit.size === 0) return value;

		const kept = value.filter((r) => !overLimit.has(r.hash.toLowerCase()));
		console.log(`🚧 Dropped ${value.length - kept.length} over-shared results`);
		return kept;
	}

	/**
	 * The whole stored array for a page key, in one read. `getScrapedTrueResults`
	 * pages 50 at a time through a JSON_TABLE scan, which is the right shape for
	 * the site's lazy lists but costs one full-array scan per page; callers that
	 * want the entire release list for a title (the Stremio addons' cached-trove
	 * source) want the row once and the slicing in JS.
	 */
	public async getAllScrapedTrueResults(key: string): Promise<ScrapeSearchResult[] | null> {
		if (!key || typeof key !== 'string') {
			throw new Error('Invalid key provided.');
		}
		const row = await this.prisma.scrapedTrue.findUnique({ where: { key } });
		return (row?.value as ScrapeSearchResult[] | undefined) ?? null;
	}
	/**
	 * One library page together with the row's own timestamp.
	 *
	 * The Torznab feed needs both. Nothing in a stored result records when the
	 * release was posted — the rows are `{hash, title, fileSize}` and nothing
	 * more — so the row's `updatedAt`, meaning "when DMM last refreshed this
	 * title's release list", is the only real date available, and an RSS parser
	 * refuses a feed whose items carry no date at all.
	 */
	public async getScrapedTrueRow(
		key: string
	): Promise<{ results: ScrapeSearchResult[]; updatedAt: Date } | null> {
		if (!key || typeof key !== 'string') {
			throw new Error('Invalid key provided.');
		}
		const row = await this.prisma.scrapedTrue.findUnique({ where: { key } });
		if (!row) return null;
		return {
			results: (row.value as ScrapeSearchResult[] | undefined) ?? [],
			updatedAt: row.updatedAt,
		};
	}

	/**
	 * The season pages that exist for one show, most recently refreshed first.
	 *
	 * Keys only — the values are never touched, so this stays cheap for a show
	 * with forty seasons. A TV search that names no season has to pick a subset
	 * of them, and **recency is the ordering that picks the real ones**: a
	 * mis-parsed release invents a season page and never touches it again, while
	 * a real season is refreshed on every scrape. Measured on 2026-09-06,
	 * `tt0903747` had season pages up to 72 — its five real seasons were the five
	 * most recently updated, holding 629–1710 releases each, while `:72`, `:71`
	 * and `:0` held three to fifteen and had not moved in nine months. Ordering
	 * by season number instead would have answered a search with page 72.
	 */
	public async getScrapedTrueSeasonKeys(imdbId: string): Promise<string[]> {
		const rows = await this.prisma.scrapedTrue.findMany({
			where: { key: { startsWith: `tv:${imdbId}:` } },
			orderBy: { updatedAt: 'desc' },
			select: { key: true },
		});
		return rows.map((row) => row.key).filter((key) => /^tv:[^:]+:\d+$/.test(key));
	}

	/**
	 * The most recently refreshed library pages, for an *arr's RSS sync.
	 *
	 * Metadata only, and bounded by the caller: an RSS sync runs on a timer
	 * against every indexer a client has, so it must cost a fixed number of reads
	 * no matter how large the library grows. The timestamps come back with the
	 * keys because the caller needs them for `pubDate` and would otherwise have to
	 * read whole rows to get them.
	 */
	public async getRecentScrapedTrueKeys(
		limit: number
	): Promise<Array<{ key: string; updatedAt: Date }>> {
		return this.prisma.scrapedTrue.findMany({
			where: { OR: [{ key: { startsWith: 'movie:tt' } }, { key: { startsWith: 'tv:tt' } }] },
			orderBy: { updatedAt: 'desc' },
			take: limit,
			select: { key: true, updatedAt: true },
		});
	}

	public async getScrapedTrueResults<T>(
		key: string,
		maxSizeGB?: number,
		page: number = 0
	): Promise<T | undefined> {
		// Input Validation
		if (!key || typeof key !== 'string') {
			throw new Error('Invalid key provided.');
		}

		const maxSizeMB = maxSizeGB && maxSizeGB > 0 ? maxSizeGB * 1024 : null;
		const offset = page * 50;

		let query = Prisma.sql`
      SELECT
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'hash', jt.hash,
            'title', jt.title,
            'fileSize', jt.fileSize
          )
        ) AS value
      FROM (
        SELECT
          jt.hash,
          jt.title,
          ${plausibleFileSize()} AS fileSize
        FROM
          ScrapedTrue s
        JOIN
          JSON_TABLE(
            s.value,
            '$[*]'
            COLUMNS (
              hash VARCHAR(255) PATH '$.hash',
              title VARCHAR(255) PATH '$.title',
              fileSize DECIMAL(10,2) PATH '$.fileSize'
            )
          ) AS jt
        WHERE
          s.key = ${key}
        ${maxSizeMB ? Prisma.sql`AND ${plausibleFileSize()} <= ${maxSizeMB}` : Prisma.empty}
        AND jt.title NOT REGEXP '^[А-Яа-яЁё]'
        ORDER BY ${plausibleFileSize()} DESC
        LIMIT 50
        OFFSET ${offset}
      ) AS jt`;

		try {
			const result = await this.prisma.$queryRaw<{ value: T }[]>(query);
			return result.length > 0 ? result[0].value : undefined;
		} catch (error) {
			console.error(
				'Database query failed:',
				error instanceof Error ? error.message : 'Unknown error'
			);
			throw new Error('Failed to retrieve scrapedtrue results.');
		}
	}

	public async getScrapedResults<T>(
		key: string,
		maxSizeGB?: number,
		page: number = 0
	): Promise<T | undefined> {
		// Input Validation
		if (!key || typeof key !== 'string') {
			throw new Error('Invalid key provided.');
		}
		if (maxSizeGB !== undefined && (typeof maxSizeGB !== 'number' || maxSizeGB < 0)) {
			throw new Error('maxSizeGB must be a positive number.');
		}

		const maxSizeMB = maxSizeGB ? maxSizeGB * 1024 : null;
		const offset = page * 50;

		let query = Prisma.sql`
      SELECT
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'hash', jt.hash,
            'title', jt.title,
            'fileSize', jt.fileSize
          )
        ) AS value
      FROM (
        SELECT
          jt.hash,
          jt.title,
          ${plausibleFileSize()} AS fileSize
        FROM
          Scraped s
        JOIN
          JSON_TABLE(
            s.value,
            '$[*]'
            COLUMNS (
              hash VARCHAR(255) PATH '$.hash',
              title VARCHAR(255) PATH '$.title',
              fileSize DECIMAL(10,2) PATH '$.fileSize'
            )
          ) AS jt
        WHERE
          s.key = ${key}
        ${maxSizeMB ? Prisma.sql`AND ${plausibleFileSize()} <= ${maxSizeMB}` : Prisma.empty}
        AND jt.title NOT REGEXP '^[А-Яа-яЁё]'
        ORDER BY ${plausibleFileSize()} DESC
        LIMIT 50
        OFFSET ${offset}
      ) AS jt`;

		try {
			const result = await this.prisma.$queryRaw<{ value: T }[]>(query);
			return result.length > 0 ? result[0].value : undefined;
		} catch (error) {
			console.error(
				'Database query failed:',
				error instanceof Error ? error.message : 'Unknown error'
			);
			throw new Error('Failed to retrieve scraped results.');
		}
	}

	public async saveScrapedTrueResults(
		key: string,
		value: ScrapeSearchResult[],
		updateUpdatedAt: boolean = true,
		replaceOldScrape: boolean = false
	) {
		await this.savePage('ScrapedTrue', key, value, updateUpdatedAt, replaceOldScrape);
	}

	/**
	 * Adds results to a `ScrapedTrue` page and runs `alongside` in the same
	 * transaction, so the page keeps them only if `alongside` succeeds too.
	 *
	 * For a write that must not happen without the page's: filing a finished
	 * transfer saved the page entry and then the `Available` row as two
	 * transactions, and a failed second one left the release on the page and out
	 * of `Available`, which every later run took for a false-positive eviction.
	 * `alongside` runs again if the page save is retried after a conflict.
	 */
	public async saveScrapedTrueResultsWith(
		key: string,
		value: ScrapeSearchResult[],
		alongside: (tx: Prisma.TransactionClient) => Promise<unknown>
	) {
		await this.savePage('ScrapedTrue', key, value, true, false, alongside);
	}

	public async saveScrapedResults(
		key: string,
		value: ScrapeSearchResult[],
		updateUpdatedAt: boolean = true,
		replaceOldScrape: boolean = false
	) {
		await this.savePage('Scraped', key, value, updateUpdatedAt, replaceOldScrape);
	}

	/**
	 * Adds results to a page, or replaces them, as one transaction holding the
	 * page's row lock.
	 *
	 * A page is one JSON array in one row, so adding a release means reading the
	 * array and writing it back with the release in it. Done as a plain read and
	 * a later write, two writers on one page each wrote an array without the
	 * other's release: measured 2026-10-04, 1,167 of 4,835 filed nzb2rd releases
	 * and 31 of 838 debrid02 ones were in `Available` and on no page of their
	 * title, so search never showed them. Viva Pinata's first season lost 21 of
	 * 25 episodes to one Transfers poll that filed them all at once.
	 *
	 * `SELECT … FOR UPDATE` reads the latest committed array, not the
	 * transaction's snapshot, and makes every other locking writer wait until
	 * this one commits. scraps' `locked_merge` and the verdict job's trash and
	 * restore lock the same row the same way. A page with no row yet has nothing
	 * to lock, so two first writers can both insert: one then fails on the
	 * duplicate key or as a deadlock victim, and runs again to find the row.
	 */
	private async savePage(
		table: PageTable,
		key: string,
		value: ScrapeSearchResult[],
		updateUpdatedAt: boolean,
		replaceOldScrape: boolean,
		alongside?: (tx: Prisma.TransactionClient) => Promise<unknown>
	) {
		value = await this.withoutFannedOutHashes(usableResults(value));
		await onePageAtATime(`${table}|${key}`, async () => {
			for (let attempt = 1; ; attempt++) {
				try {
					return await this.mergeIntoPage(
						table,
						key,
						value,
						updateUpdatedAt,
						replaceOldScrape,
						alongside
					);
				} catch (error) {
					if (attempt >= PAGE_SAVE_ATTEMPTS || !isPageWriteConflict(error)) throw error;
				}
			}
		});
	}

	private mergeIntoPage(
		table: PageTable,
		key: string,
		value: ScrapeSearchResult[],
		updateUpdatedAt: boolean,
		replaceOldScrape: boolean,
		alongside?: (tx: Prisma.TransactionClient) => Promise<unknown>
	) {
		const page = Prisma.raw(`\`${table}\``);
		return this.prisma.$transaction(
			async (tx) => {
				const [row] = await tx.$queryRaw<{ value: Prisma.JsonValue; updatedAt: Date }[]>(
					Prisma.sql`SELECT value, updatedAt FROM ${page} WHERE \`key\` = ${key} FOR UPDATE`
				);
				if (!row) {
					await tx.$executeRaw(
						Prisma.sql`INSERT INTO ${page} (\`key\`, value, updatedAt) VALUES (${key}, ${JSON.stringify(value)}, ${new Date()})`
					);
					await alongside?.(tx);
					return;
				}

				let next = value;
				if (!replaceOldScrape) {
					const stored = Array.isArray(row.value)
						? (row.value as unknown as ScrapeSearchResult[])
						: [];
					next = sortByFileSize(flattenAndRemoveDuplicates([stored, value]));
					// Log update count without exposing the key
					console.log(`📝 Updated: +${next.length - stored.length} results`);
				}
				const updatedAt = updateUpdatedAt ? new Date() : row.updatedAt;
				await tx.$executeRaw(
					Prisma.sql`UPDATE ${page} SET value = ${JSON.stringify(next)}, updatedAt = ${updatedAt} WHERE \`key\` = ${key}`
				);
				await alongside?.(tx);
			},
			// Waiting on another writer's lock counts against the timeout. A
			// connection may take as long as the pool's own 10s to come free.
			{ maxWait: 10_000, timeout: 30_000 }
		);
	}

	public async keyExists(key: string): Promise<boolean> {
		const cacheEntry = await this.prisma.scraped.findFirst({
			where: { key },
			select: { key: true },
		});
		return cacheEntry !== null;
	}

	public async isOlderThan(imdbId: string, daysAgo: number): Promise<boolean> {
		const cacheEntry = await this.prisma.scraped.findFirst({
			where: {
				OR: [
					{ key: { startsWith: `movie:${imdbId}` } },
					{ key: { startsWith: `tv:${imdbId}` } },
				],
			},
			select: { updatedAt: true },
		});
		if (!cacheEntry || !cacheEntry.updatedAt) {
			return true; // If it doesn't exist, assume it's old
		}
		const updatedAt = cacheEntry.updatedAt;
		const currentTime = Date.now();
		const millisAgo = daysAgo * 24 * 60 * 60 * 1000;
		const dateXdaysAgo = new Date(currentTime - millisAgo);
		return updatedAt <= dateXdaysAgo;
	}

	public async getOldestRequest(
		olderThan: Date | null = null
	): Promise<{ key: string; updatedAt: Date } | null> {
		const whereCondition: any = {
			key: { startsWith: 'requested:tt' },
		};

		if (olderThan !== null) {
			whereCondition.updatedAt = { gt: olderThan };
		}

		const requestedItem = await this.prisma.scraped.findFirst({
			where: whereCondition,
			orderBy: { updatedAt: 'asc' },
			select: { key: true, updatedAt: true },
		});

		if (requestedItem !== null) {
			return {
				key: requestedItem.key.split(':')[1],
				updatedAt: requestedItem.updatedAt,
			};
		}

		return null;
	}

	public async processingMoreThanAnHour(): Promise<string | null> {
		const oneHourAgo = new Date();
		oneHourAgo.setHours(oneHourAgo.getHours() - 1);

		const requestedItem = await this.prisma.scraped.findFirst({
			where: {
				key: { startsWith: 'processing:tt' },
				updatedAt: { lte: oneHourAgo },
			},
			orderBy: { updatedAt: 'asc' },
			select: { key: true },
		});

		if (requestedItem !== null) {
			await this.prisma.scraped.update({
				where: { key: requestedItem.key },
				data: { updatedAt: new Date() },
			});

			return requestedItem.key.split(':')[1];
		}

		return null;
	}

	public async getOldestScrapedMedia(
		mediaType: 'tv' | 'movie',
		quantity = 3
	): Promise<string[] | null> {
		const scrapedItems = await this.prisma.scraped.findMany({
			where: {
				key: { startsWith: `${mediaType}:tt` },
			},
			orderBy: { updatedAt: 'asc' },
			take: quantity,
			select: { key: true },
		});

		if (scrapedItems.length > 0) {
			return scrapedItems.map((item) => item.key.split(':')[1]);
		}

		return null;
	}

	public async getAllImdbIds(mediaType: 'tv' | 'movie'): Promise<string[] | null> {
		const scrapedItems = await this.prisma.scraped.findMany({
			where: {
				key: { startsWith: `${mediaType}:tt` },
			},
			orderBy: { updatedAt: 'asc' },
			select: { key: true },
		});

		if (scrapedItems.length > 0) {
			// ensure unique imdbIds
			return Array.from(new Set(scrapedItems.map((item) => item.key.split(':')[1])));
		}

		return null;
	}

	public async markAsDone(imdbId: string): Promise<void> {
		const keys = [`requested:${imdbId}`, `processing:${imdbId}`];

		for (const key of keys) {
			await this.prisma.scraped.deleteMany({
				where: { key },
			});
		}
	}

	public async getRecentlyUpdatedContent(): Promise<string[]> {
		const [scrapedRows, scrapedTrueRows] = await Promise.all([
			this.prisma.scraped.findMany({
				take: 100,
				orderBy: {
					updatedAt: 'desc',
				},
				where: {
					OR: [{ key: { startsWith: 'movie:tt' } }, { key: { startsWith: 'tv:tt' } }],
				},
				select: {
					key: true,
					updatedAt: true,
				},
			}),
			this.prisma.scrapedTrue.findMany({
				take: 100,
				orderBy: {
					updatedAt: 'desc',
				},
				where: {
					OR: [{ key: { startsWith: 'movie:tt' } }, { key: { startsWith: 'tv:tt' } }],
				},
				select: {
					key: true,
					updatedAt: true,
				},
			}),
		]);

		// Combine and sort by updatedAt
		const allRows = [...scrapedRows, ...scrapedTrueRows]
			.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
			.slice(0, 200);

		return allRows
			.map((row: any) => {
				const match = row.key.match(/^(movie|tv):([^:]+)/);
				if (match) {
					return `${match[1]}:${match[2]}`;
				}
				return '';
			})
			.filter((key: any) => key !== '');
	}

	public async getContentSize(): Promise<number> {
		const result = await this.prisma.$queryRaw<[{ contentSize: number }]>`
      SELECT count(*) as contentSize
      FROM Scraped
      WHERE Scraped.key LIKE 'movie:%' OR Scraped.key LIKE 'tv:%';
    `;
		return parseInt(result[0].contentSize.toString());
	}

	public async getProcessingCount(): Promise<number> {
		const result = await this.prisma.$queryRaw<[{ processing: number }]>`
      SELECT count(*) as processing
      FROM Scraped
      WHERE Scraped.key LIKE 'processing:%';
    `;
		return parseInt(result[0].processing.toString());
	}

	public async getRequestedCount(): Promise<number> {
		const result = await this.prisma.$queryRaw<[{ requested: number }]>`
      SELECT count(*) as requested
      FROM Scraped
      WHERE Scraped.key LIKE 'requested:%';
    `;
		return parseInt(result[0].requested.toString());
	}
}
