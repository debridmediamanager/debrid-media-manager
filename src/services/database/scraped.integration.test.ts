// @vitest-environment node
/**
 * Saving into a library page against a real MySQL, with several writers on one page.
 *
 * A library page is one JSON array in one row (`ScrapedTrue` / `Scraped`), so
 * filing a release means reading the array, adding to it and writing it back.
 * Done as a plain read and a later write, two writers on one page each wrote an
 * array without the other's release. On 2026-10-04, 1,167 of 4,835 filed nzb2rd
 * releases and 31 of 838 debrid02 ones were in `Available` and in no page of
 * their title, so search never showed them; 1,096 of those 1,198 had a sibling
 * of the same title filed within two seconds, against 579 of the 4,475 that
 * survived. The Transfers page files every completed row of a page at once.
 *
 * The pages and filings are recorded (`fixtures/transfers/lost-filings-2026-10-04.json`):
 * Viva Pinata season 1, where one poll filed 25 episodes and the page kept 4,
 * and Rock Follies season 1, where three filings inside 90 ms kept two. The
 * tables are dmmdb's own DDL on the server version it runs.
 *
 * The other writer is a second client doing what scraps' `locked_merge` does:
 * lock the row, change it, commit. Interleavings are forced, not left to
 * timing: it holds its lock until InnoDB reports the save under test waiting
 * on it, which a locked save does at its read and an unlocked one only at its
 * write, after it has already read the old array.
 *
 * Needs Docker. Skipped without it, like the other integration tests.
 */
import recorded from '@/test/fixtures/transfers/lost-filings-2026-10-04.json';
import { Prisma, PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import path from 'path';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ScrapeSearchResult } from '../mediasearch';
import { ScrapedService } from './scraped';

let dockerAvailable = false;
try {
	const { getContainerRuntimeClient } = await import('testcontainers');
	await getContainerRuntimeClient();
	dockerAvailable = true;
} catch {
	dockerAvailable = false;
}

const DDL = readFileSync(
	path.resolve(__dirname, '../../test/fixtures/mysql/scraped-tables.sql'),
	'utf8'
)
	.split(/^;$/m)
	.map((statement) =>
		statement
			.split('\n')
			.filter((line) => !line.startsWith('--'))
			.join('\n')
			.trim()
	)
	.filter(Boolean);

type Filing = (typeof recorded.pages)[number]['filings'][number];
const pageOf = (key: string) => recorded.pages.find((p) => p.key === key)!;
const entryOf = (f: Filing): ScrapeSearchResult => ({
	hash: f.hash,
	title: f.title,
	fileSize: f.fileSize,
});

/** The service under test, on the test database instead of the app's client. */
class ScrapedServiceOn extends ScrapedService {
	constructor(client: PrismaClient) {
		super();
		this.prisma = client;
	}
}

describe.skipIf(!dockerAvailable)('Library page saves on MySQL 8.0.36 (Integration)', () => {
	let container: StartedTestContainer;
	/** The app's client: one pool, as one Swarm replica has. */
	let writer: PrismaClient;
	/** Another writer: a second replica, or a scraps spider. */
	let other: PrismaClient;
	let monitor: PrismaClient;
	let service: ScrapedService;

	beforeAll(async () => {
		container = await new GenericContainer('mysql:8.0.36')
			.withEnvironment({ MYSQL_ROOT_PASSWORD: 'test', MYSQL_DATABASE: 'dmm_test' })
			.withExposedPorts(3306)
			.withTmpFs({ '/var/lib/mysql': 'rw' })
			// The init run logs "ready for connections" on port 0 first.
			.withWaitStrategy(Wait.forLogMessage(/ready for connections.*port: 3306 /))
			.withStartupTimeout(180_000)
			.start();
		const url = `mysql://root:test@${container.getHost()}:${container.getMappedPort(3306)}/dmm_test`;
		writer = new PrismaClient({ datasourceUrl: `${url}?connection_limit=40` });
		other = new PrismaClient({ datasourceUrl: url });
		monitor = new PrismaClient({ datasourceUrl: url });
		for (const statement of DDL) await monitor.$executeRawUnsafe(statement);
		const [settings] = await monitor.$queryRaw<{ isolation: string }[]>`
			SELECT @@transaction_isolation AS isolation`;
		expect(settings.isolation).toBe('REPEATABLE-READ');
		service = new ScrapedServiceOn(writer);
	}, 240_000);

	afterAll(async () => {
		await Promise.all([writer, other, monitor].map((c) => c?.$disconnect()));
		await container?.stop();
	});

	beforeEach(async () => {
		for (const table of ['ScrapedTrue', 'Scraped', 'HashPageCount']) {
			await monitor.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``);
		}
	});

	const read = async (table: 'ScrapedTrue' | 'Scraped', key: string) => {
		const row =
			table === 'ScrapedTrue'
				? await monitor.scrapedTrue.findUnique({ where: { key } })
				: await monitor.scraped.findUnique({ where: { key } });
		return row
			? { results: row.value as ScrapeSearchResult[], updatedAt: row.updatedAt }
			: null;
	};
	const hashesIn = async (table: 'ScrapedTrue' | 'Scraped', key: string) =>
		new Set((await read(table, key))?.results.map((r) => r.hash) ?? []);

	const seed = (table: 'ScrapedTrue' | 'Scraped', key: string, results: unknown[], at: Date) =>
		monitor.$executeRaw`INSERT INTO ${Prisma.raw(`\`${table}\``)} (\`key\`, value, updatedAt)
			VALUES (${key}, ${JSON.stringify(results)}, ${at})`;

	// Not information_schema.INNODB_TRX: InnoDB refreshes that table only after
	// 100 ms without a read, so polling it faster keeps showing the moment the
	// first poll saw, and a save blocked for 15 s never appeared there.
	const lockWaiters = async () => {
		const [row] = await monitor.$queryRaw<{ n: bigint }[]>`
			SELECT COUNT(DISTINCT REQUESTING_ENGINE_TRANSACTION_ID) AS n
			FROM performance_schema.data_lock_waits`;
		return Number(row.n);
	};
	const untilLockWaiters = async (n: number) => {
		const deadline = Date.now() + 15_000;
		while ((await lockWaiters()) < n) {
			if (Date.now() > deadline) {
				throw new Error(`no save ever waited on the other writer's lock (wanted ${n})`);
			}
			await new Promise((r) => setTimeout(r, 10));
		}
	};

	/**
	 * Runs `save` while another writer holds the page's row: it locks the row
	 * (or, for a page with no row yet, the gap where it goes), makes its own
	 * change, and commits only once InnoDB shows something waiting on it.
	 * Deadlock victims retry, as scraps' `locked_merge` does.
	 */
	const whileAnotherWriterHolds = async (
		table: 'ScrapedTrue' | 'Scraped',
		key: string,
		change: (tx: Prisma.TransactionClient, held: () => void) => Promise<void>,
		save: () => Promise<unknown>
	) => {
		let held!: () => void;
		const holding = new Promise<void>((resolve) => (held = resolve));
		const otherWriter = (async () => {
			for (let attempt = 1; ; attempt++) {
				try {
					return await other.$transaction(
						async (tx) => {
							await tx.$queryRaw`SELECT value FROM ${Prisma.raw(`\`${table}\``)}
								WHERE \`key\` = ${key} FOR UPDATE`;
							await change(tx, held);
						},
						{ timeout: 60_000 }
					);
				} catch (error) {
					if (attempt < 5 && /1213|Deadlock/.test(String(error))) continue;
					throw error;
				}
			}
		})();
		await holding;
		const saving = save();
		const [otherResult, saveResult] = await Promise.allSettled([otherWriter, saving]);
		expect(otherResult).toEqual({ status: 'fulfilled', value: undefined });
		return saveResult;
	};

	// Rock Follies S01, 2026-10-02 02:44:53: E01, E02 and E05 filed within 90 ms
	// and the page kept E01 and E05.
	it('keeps a release another writer filed while this save was reading the page', async () => {
		const { key, filings } = pageOf('tv:tt0074049:1');
		const [e01, e02, e05] = filings;
		await seed('ScrapedTrue', key, [entryOf(e01)], new Date(e01.filedAt));

		const saved = await whileAnotherWriterHolds(
			'ScrapedTrue',
			key,
			async (tx, held) => {
				await tx.$executeRaw`UPDATE ScrapedTrue
					SET value = JSON_ARRAY_APPEND(value, '$', CAST(${JSON.stringify(entryOf(e05))} AS JSON)),
						updatedAt = ${new Date(e05.filedAt)}
					WHERE \`key\` = ${key}`;
				held();
				await untilLockWaiters(1);
			},
			() => service.saveScrapedTrueResults(key, [entryOf(e02)], true)
		);

		expect(saved.status).toBe('fulfilled');
		expect(await hashesIn('ScrapedTrue', key)).toEqual(new Set([e01.hash, e02.hash, e05.hash]));
	});

	it('keeps the other writer’s release on the untrusted table too', async () => {
		const { key, filings } = pageOf('tv:tt0074049:1');
		const [e01, e02, e05] = filings;
		await seed('Scraped', key, [entryOf(e01)], new Date(e01.filedAt));

		const saved = await whileAnotherWriterHolds(
			'Scraped',
			key,
			async (tx, held) => {
				await tx.$executeRaw`UPDATE Scraped
					SET value = JSON_ARRAY_APPEND(value, '$', CAST(${JSON.stringify(entryOf(e05))} AS JSON))
					WHERE \`key\` = ${key}`;
				held();
				await untilLockWaiters(1);
			},
			() => service.saveScrapedResults(key, [entryOf(e02)], true)
		);

		expect(saved.status).toBe('fulfilled');
		expect(await hashesIn('Scraped', key)).toEqual(new Set([e01.hash, e02.hash, e05.hash]));
	});

	it('files into a page another writer is creating instead of failing on its key', async () => {
		const { key, filings } = pageOf('tv:tt0074049:1');
		const [e01, e02] = filings;

		const saved = await whileAnotherWriterHolds(
			'ScrapedTrue',
			key,
			async (tx, held) => {
				await tx.$executeRaw`INSERT INTO ScrapedTrue (\`key\`, value, updatedAt)
					VALUES (${key}, ${JSON.stringify([entryOf(e01)])}, ${new Date(e01.filedAt)})`;
				held();
				await untilLockWaiters(1);
			},
			() => service.saveScrapedTrueResults(key, [entryOf(e02)], true)
		);

		expect(saved.status).toBe('fulfilled');
		expect(await hashesIn('ScrapedTrue', key)).toEqual(new Set([e01.hash, e02.hash]));
	});

	// Both writers lock the empty gap a new page goes into, then both insert:
	// InnoDB rolls one back with a deadlock. The other writer has already
	// written elsewhere in its transaction, so InnoDB picks the save under test
	// as the lighter victim, and only a save that retries keeps its release.
	it('retries when InnoDB picks it as the deadlock victim on a new page', async () => {
		const { key, filings } = pageOf('tv:tt0074049:1');
		const [e01, e02] = filings;

		const saved = await whileAnotherWriterHolds(
			'ScrapedTrue',
			key,
			async (tx, held) => {
				await tx.$executeRaw`INSERT INTO ScrapedTrue (\`key\`, value, updatedAt)
					VALUES ('tv:tt0074049:2', '[]', ${new Date(e01.filedAt)})`;
				held();
				await untilLockWaiters(1);
				await tx.$executeRaw`INSERT INTO ScrapedTrue (\`key\`, value, updatedAt)
					VALUES (${key}, ${JSON.stringify([entryOf(e01)])}, ${new Date(e01.filedAt)})`;
			},
			() => service.saveScrapedTrueResults(key, [entryOf(e02)], true)
		);

		expect(saved.status).toBe('fulfilled');
		expect(await hashesIn('ScrapedTrue', key)).toEqual(new Set([e01.hash, e02.hash]));
	});

	// Viva Pinata S01, 2026-09-07 06:27: E18 opened the page at 25.865 and one
	// Transfers poll filed the other 24 episodes over the next five seconds.
	// The page kept four of the 25.
	it('keeps every episode when a Transfers poll files a whole season at once', async () => {
		const { key, filings, page } = pageOf('tv:tt0837069:1');
		const [first, ...rest] = filings;
		expect(page.results).toHaveLength(4);
		expect(filings.filter((f) => !f.inPage)).toHaveLength(21);
		await seed('ScrapedTrue', key, [entryOf(first)], new Date(first.filedAt));

		const outcomes = await Promise.allSettled(
			rest.map((f) => service.saveScrapedTrueResults(key, [entryOf(f)], true))
		);

		expect(outcomes.filter((o) => o.status === 'rejected')).toEqual([]);
		const stored = (await read('ScrapedTrue', key))!.results;
		const lost = filings.filter((f) => !stored.some((r) => r.hash === f.hash));
		expect(lost.map((f) => f.title)).toEqual([]);
		expect(stored).toHaveLength(25);
		const sizes = stored.map((r) => r.fileSize);
		expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
	});

	it('keeps what the save options mean for updatedAt and replacement', async () => {
		const { key, filings } = pageOf('tv:tt0074049:1');
		const [e01, e02, e05] = filings;
		const recordedAt = new Date('2026-10-02T02:44:53.959Z');
		await seed('ScrapedTrue', key, [entryOf(e01)], recordedAt);

		// Filing without touching: the page keeps the date the feed publishes.
		await service.saveScrapedTrueResults(key, [entryOf(e02)], false);
		expect((await read('ScrapedTrue', key))!.updatedAt).toEqual(recordedAt);

		// Filing with touching dates it now, in UTC like every other write.
		const before = Date.now();
		await service.saveScrapedTrueResults(key, [entryOf(e05)], true);
		const touched = (await read('ScrapedTrue', key))!;
		expect(touched.updatedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
		expect(touched.updatedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
		expect(new Set(touched.results.map((r) => r.hash))).toEqual(
			new Set([e01.hash, e02.hash, e05.hash])
		);

		// Replacing drops what was there.
		await service.saveScrapedTrueResults(key, [entryOf(e05)], false, true);
		expect((await read('ScrapedTrue', key))!.results).toEqual([entryOf(e05)]);

		// A new page is dated now.
		await service.saveScrapedTrueResults('tv:tt0074049:2', [entryOf(e01)], false);
		const created = (await read('ScrapedTrue', 'tv:tt0074049:2'))!;
		expect(created.results).toEqual([entryOf(e01)]);
		expect(created.updatedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
	});
});
