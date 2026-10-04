// @vitest-environment node
/**
 * The written-back trash sweep against a real MySQL, with a scraper writing the
 * page it is cleaning.
 *
 * The sweep moves results off a library page the way the page view's verdict
 * pass does, through `trashPairs`: lock the page's row, drop what has a trash
 * verdict, write the rest back. A scraper is merging into the same pages at the
 * same time (scraps' `locked_merge` locks the row the same way), and a sweep
 * that worked on an array it had read earlier would write the scraper's new
 * release out of the page again. Interleavings are forced, not left to timing:
 * the other writer holds its lock until InnoDB reports the sweep waiting on it.
 *
 * The page is the recorded Doraemon page (`__fixtures__/written-back-trash.json`),
 * on dmmdb's own DDL. Needs Docker. Skipped without it, like the other
 * integration tests.
 */
import { ScrapedVerdictService, titleKeyOf } from '@/services/database/scrapedVerdict';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import path from 'path';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import recorded from './__fixtures__/written-back-trash.json';
import { ENGINE } from './job';
import { sweepWrittenBackTrash } from './sweep';

let dockerAvailable = false;
try {
	const { getContainerRuntimeClient } = await import('testcontainers');
	await getContainerRuntimeClient();
	dockerAvailable = true;
} catch {
	dockerAvailable = false;
}

const statementsIn = (file: string) =>
	readFileSync(path.resolve(__dirname, '../../test/fixtures/mysql', file), 'utf8')
		.split(/^;$/m)
		.map((statement) =>
			statement
				.split('\n')
				.filter((line) => !line.startsWith('--'))
				.join('\n')
				.trim()
		)
		.filter(Boolean);

/** The service under test, on the test database instead of the app's client. */
class ScrapedVerdictServiceOn extends ScrapedVerdictService {
	constructor(client: PrismaClient) {
		super();
		this.prisma = client;
	}
}

const page = recorded.pages.find((p) => p.imdbId === 'tt0313990')!;
const stored = page.ScrapedTrue!;
const entryOf = (e: (typeof stored.entries)[number]) => ({
	hash: e.hash,
	title: e.title,
	fileSize: e.fileSize,
});
/** A release the scraper finds while the sweep is running. */
const merged = {
	hash: 'c'.repeat(40),
	title: "Doraemon Nobita's Little Star Wars 1985 1080p BluRay x264",
	fileSize: 4321,
};

describe.skipIf(!dockerAvailable)('Written-back trash sweep on MySQL 8.0.36 (Integration)', () => {
	let container: StartedTestContainer;
	let app: PrismaClient;
	/** A scraps spider. */
	let scraper: PrismaClient;
	let monitor: PrismaClient;
	let service: ScrapedVerdictService;

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
		app = new PrismaClient({ datasourceUrl: url });
		scraper = new PrismaClient({ datasourceUrl: url });
		monitor = new PrismaClient({ datasourceUrl: url });
		for (const statement of [
			...statementsIn('scraped-tables.sql'),
			...statementsIn('verdict-tables.sql'),
		]) {
			await monitor.$executeRawUnsafe(statement);
		}
		service = new ScrapedVerdictServiceOn(app);
	}, 240_000);

	afterAll(async () => {
		await Promise.all([app, scraper, monitor].map((c) => c?.$disconnect()));
		await container?.stop();
	});

	beforeEach(async () => {
		vi.stubEnv('TYPESAFE_API_KEY', 'test-key');
		vi.spyOn(console, 'log').mockImplementation(() => {});
		for (const table of ['ScrapedTrue', 'Scraped', 'ScrapedVerdict', 'ScrapedTrash', 'Cache']) {
			await monitor.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``);
		}
		await monitor.$executeRawUnsafe('DELETE FROM imdb_title_basics');
		await monitor.$executeRaw`INSERT INTO imdb_title_basics (tconst, title_type, primary_title, start_year)
			VALUES (${page.imdbId}, 'movie', ${page.movieTitle}, ${page.year})`;
		await monitor.$executeRaw`INSERT INTO ScrapedTrue (\`key\`, value, updatedAt)
			VALUES (${page.key}, ${JSON.stringify(stored.entries.map(entryOf))}, ${new Date(stored.updatedAt)})`;
		for (const e of stored.entries) {
			await monitor.$executeRaw`INSERT INTO ScrapedVerdict
				(imdbId, hash, titleKey, title, verdict, rule, engine)
				VALUES (${page.imdbId}, ${e.hash}, ${titleKeyOf(e.title)}, ${e.title}, ${e.verdict!}, 'jev', 'rules-v6.5+jev/jev-1.13.0')`;
		}
	});

	const pageNow = async () => {
		const row = await monitor.scrapedTrue.findUnique({ where: { key: page.key } });
		return {
			hashes: new Set((row!.value as { hash: string }[]).map((r) => r.hash)),
			updatedAt: row!.updatedAt,
		};
	};
	const lockWaiters = async () => {
		const [row] = await monitor.$queryRaw<{ n: bigint }[]>`
			SELECT COUNT(DISTINCT REQUESTING_ENGINE_TRANSACTION_ID) AS n
			FROM performance_schema.data_lock_waits`;
		return Number(row.n);
	};
	const untilSomethingWaits = async () => {
		const deadline = Date.now() + 15_000;
		while ((await lockWaiters()) < 1) {
			if (Date.now() > deadline) throw new Error('the sweep never waited on the scraper');
			await new Promise((r) => setTimeout(r, 10));
		}
	};

	const kept = new Set(stored.entries.filter((e) => e.verdict === 'keep').map((e) => e.hash));
	const trashed = stored.entries.filter((e) => e.verdict === 'trash');

	it('moves the written-back trash and keeps a release a scraper merged in meanwhile', async () => {
		expect(trashed).toHaveLength(4);
		const mergedAt = new Date('2026-10-04T09:00:00.000Z');

		let held!: () => void;
		const holding = new Promise<void>((resolve) => (held = resolve));
		const scraping = scraper.$transaction(
			async (tx) => {
				await tx.$queryRaw`SELECT value FROM ScrapedTrue WHERE \`key\` = ${page.key} FOR UPDATE`;
				await tx.$executeRaw`UPDATE ScrapedTrue
					SET value = JSON_ARRAY_APPEND(value, '$', CAST(${JSON.stringify(merged)} AS JSON)),
						updatedAt = ${mergedAt}
					WHERE \`key\` = ${page.key}`;
				held();
				await untilSomethingWaits();
			},
			{ timeout: 60_000 }
		);
		await holding;
		const [scraped, swept] = await Promise.all([scraping, sweepWrittenBackTrash(service)]);

		expect(scraped).toBeUndefined();
		expect(swept).toEqual({ status: 'done', pages: 1, judgedPages: 1, moved: 4, failed: 0 });
		const after = await pageNow();
		expect(after.hashes).toEqual(new Set([...kept, merged.hash]));
		// The page keeps the scraper's date: the feed publishes it.
		expect(after.updatedAt).toEqual(mergedAt);

		const trash = await monitor.scrapedTrash.findMany({ orderBy: { id: 'asc' } });
		expect(trash.map((t) => t.hash).sort()).toEqual(trashed.map((e) => e.hash).sort());
		expect(
			new Set(trash.map((t) => `${t.source} ${t.rule} ${t.engine} ${t.movieTitle}`))
		).toEqual(new Set([`ScrapedTrue reused ${ENGINE}/sweep ${page.movieTitle}`]));
	});

	it('reads on from where it stopped, and moves a result written back again', async () => {
		await sweepWrittenBackTrash(service);
		const cursor = await monitor.cache.findUnique({
			where: { key: 'verdicts:sweep:ScrapedTrue' },
		});
		expect(cursor?.value).toEqual({ key: page.key, at: stored.updatedAt });

		expect(await sweepWrittenBackTrash(service)).toMatchObject({ pages: 0, moved: 0 });

		// A scraper finds one of them again.
		const again = trashed[0];
		await scraper.$executeRaw`UPDATE ScrapedTrue
			SET value = JSON_ARRAY_APPEND(value, '$', CAST(${JSON.stringify(entryOf(again))} AS JSON)),
				updatedAt = ${new Date(Date.now() - 10 * 60 * 1000)}
			WHERE \`key\` = ${page.key}`;
		expect(await sweepWrittenBackTrash(service)).toMatchObject({ pages: 1, moved: 1 });
		expect((await pageNow()).hashes).toEqual(kept);
		expect(await monitor.scrapedTrash.count()).toBe(5);
	});
});
