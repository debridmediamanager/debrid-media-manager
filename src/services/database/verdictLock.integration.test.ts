// @vitest-environment node
/**
 * The verdict pass's cross-replica lock against a real MySQL, with the block
 * production printed whenever two replicas wanted the same page.
 *
 * `acquireLock` took the lock by creating its `Cache` row and caught the
 * unique-key error when another replica held it. That worked, but Prisma prints
 * every failed query from its own `error` log before the caller sees the
 * rejection, and dmm's client logs at that level, so each contended lock printed
 * a five-line "Invalid `prisma.cache.create()` invocation" block: 11 between
 * 13:35 and 16:44 UTC on 2026-10-07, six of them inside 13 seconds
 * (`scrapedVerdicts/__fixtures__/lock-contention-2026-10-07.json`).
 *
 * The lock itself must not change: one holder at a time, a lock older than
 * `staleMs` taken over by exactly one caller, a release freeing it.
 *
 * Needs Docker. Skipped without it, like the other integration tests.
 */
import recorded from '@/services/scrapedVerdicts/__fixtures__/lock-contention-2026-10-07.json';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import path from 'path';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let dockerAvailable = false;
try {
	const { getContainerRuntimeClient } = await import('testcontainers');
	await getContainerRuntimeClient();
	dockerAvailable = true;
} catch {
	dockerAvailable = false;
}

// dmmdb's own `Cache` DDL, as the verdict tests load it.
const CACHE_DDL = readFileSync(
	path.resolve(__dirname, '../../test/fixtures/mysql/verdict-tables.sql'),
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
	.find((statement) => statement.startsWith('CREATE TABLE `Cache`'))!;

const STALE_MS = 15 * 60 * 1000;

// eslint-disable-next-line no-control-regex
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

describe.skipIf(!dockerAvailable)('The verdict lock on MySQL 8.0.36 (Integration)', () => {
	let container: StartedTestContainer;
	let url: string;
	let monitor: PrismaClient;
	let ScrapedVerdictService: typeof import('./scrapedVerdict').ScrapedVerdictService;
	let service: import('./scrapedVerdict').ScrapedVerdictService;

	// What Prisma prints through `log: ['warn', 'error']`, which is the app's
	// client configuration: `console.log('prisma:error', message)`.
	let printed: string[] = [];
	const prismaLines = () => printed.filter((block) => block.startsWith('prisma:'));

	beforeAll(async () => {
		container = await new GenericContainer('mysql:8.0.36')
			.withEnvironment({ MYSQL_ROOT_PASSWORD: 'test', MYSQL_DATABASE: 'dmm_test' })
			.withExposedPorts(3306)
			.withTmpFs({ '/var/lib/mysql': 'rw' })
			// The init run logs "ready for connections" on port 0 first.
			.withWaitStrategy(Wait.forLogMessage(/ready for connections.*port: 3306 /))
			.withStartupTimeout(180_000)
			.start();
		url = `mysql://root:test@${container.getHost()}:${container.getMappedPort(3306)}/dmm_test`;
		monitor = new PrismaClient({ datasourceUrl: url });
		await monitor.$executeRawUnsafe(CACHE_DDL);
		// The service builds the app's one Prisma client from DATABASE_URL.
		process.env.DATABASE_URL = `${url}?connection_limit=16`;
		({ ScrapedVerdictService } = await import('./scrapedVerdict'));
		service = new ScrapedVerdictService();
	}, 240_000);

	afterAll(async () => {
		await service?.disconnect();
		await monitor?.$disconnect();
		await container?.stop();
	});

	beforeEach(async () => {
		await monitor.$executeRawUnsafe('TRUNCATE TABLE `Cache`');
		printed = [];
		vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
			printed.push(stripAnsi(args.map(String).join(' ')));
		});
		vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
			printed.push(stripAnsi(args.map(String).join(' ')));
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	const lockRows = async () =>
		(await monitor.cache.findMany({ select: { key: true }, orderBy: { key: 'asc' } })).map(
			(row) => row.key
		);

	// The block in the fixture is what a caught `create` of a held key prints on
	// this Prisma and MySQL, so its absence below is the production line going
	// away rather than some other line.
	it('prints the production block for a caught create of a held lock row', async () => {
		const client = new PrismaClient({ datasourceUrl: url, log: ['warn', 'error'] });
		try {
			await client.cache.create({ data: { key: 'verdicts:lock:movie:tt1', value: {} } });
			await client.cache
				.create({ data: { key: 'verdicts:lock:movie:tt1', value: {} } })
				.catch(() => undefined);
		} finally {
			await client.$disconnect();
		}

		const [block] = prismaLines();
		const lines = block.split('\n');
		expect(lines[0]).toBe(recorded.printed[0]);
		// Run from source, Prisma frames the call site; the bundled production
		// build has no source to frame and names the generic call instead.
		expect(lines[1]).toMatch(/^Invalid `.*\.create\(\)` invocation/);
		expect(lines.at(-1)).toBe(recorded.printed.at(-1));
	});

	it('refuses a held lock without printing anything', async () => {
		await expect(service.acquireLock('movie:tt0111161', STALE_MS)).resolves.toBe(true);
		await expect(service.acquireLock('movie:tt0111161', STALE_MS)).resolves.toBe(false);

		expect(prismaLines()).toEqual([]);
		expect(await lockRows()).toEqual(['verdicts:lock:movie:tt0111161']);
	});

	// Six of production's eleven blocks came inside 13 seconds, replicas racing
	// for the same pages.
	it('hands a contended lock to exactly one caller, silently, round after round', async () => {
		for (let round = 0; round < 20; round++) {
			const won = await Promise.all(
				Array.from({ length: 8 }, () => service.acquireLock(`movie:tt${round}`, STALE_MS))
			);
			expect(won.filter(Boolean)).toHaveLength(1);
		}
		expect(prismaLines()).toEqual([]);
	});

	it('takes over a stale lock', async () => {
		await service.acquireLock('sweep', STALE_MS);
		await monitor.$executeRaw`UPDATE Cache SET updatedAt = ${new Date(Date.now() - STALE_MS - 60_000)} WHERE \`key\` = 'verdicts:lock:sweep'`;

		await expect(service.acquireLock('sweep', STALE_MS)).resolves.toBe(true);
		// The takeover refreshed the row, so it is live again.
		await expect(service.acquireLock('sweep', STALE_MS)).resolves.toBe(false);
		expect(prismaLines()).toEqual([]);
	});

	it('does not take over a lock that is not stale yet', async () => {
		await service.acquireLock('sweep', STALE_MS);
		await monitor.$executeRaw`UPDATE Cache SET updatedAt = ${new Date(Date.now() - STALE_MS + 60_000)} WHERE \`key\` = 'verdicts:lock:sweep'`;

		await expect(service.acquireLock('sweep', STALE_MS)).resolves.toBe(false);
	});

	it('is free again once released', async () => {
		await service.acquireLock('movie:tt0068646', STALE_MS);
		await service.releaseLock('movie:tt0068646');

		await expect(service.acquireLock('movie:tt0068646', STALE_MS)).resolves.toBe(true);
		expect(prismaLines()).toEqual([]);
	});

	// `INSERT IGNORE` downgrades more than duplicates: an over-long key is cut to
	// the column and inserted, which would hand out a lock that `releaseLock`
	// could never find by name.
	it('refuses a key the column would truncate, which IGNORE would insert cut short', async () => {
		const long = `verdicts:lock:${'x'.repeat(190)}`;
		await monitor.$executeRaw`INSERT IGNORE INTO Cache (\`key\`, value, updatedAt) VALUES (${long}, '{}', NOW(3))`;
		expect((await lockRows())[0]).toHaveLength(191);
		await monitor.$executeRawUnsafe('TRUNCATE TABLE `Cache`');

		await expect(service.acquireLock('x'.repeat(190), STALE_MS)).rejects.toThrow(/too long/);
		expect(await lockRows()).toEqual([]);
	});

	it('lets a real database error through', async () => {
		await monitor.$executeRawUnsafe('RENAME TABLE `Cache` TO `CacheAway`');
		try {
			await expect(service.acquireLock('movie:tt1', STALE_MS)).rejects.toThrow();
		} finally {
			await monitor.$executeRawUnsafe('RENAME TABLE `CacheAway` TO `Cache`');
		}
	});
});
