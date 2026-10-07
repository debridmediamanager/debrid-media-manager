// @vitest-environment node
/**
 * The cron's pass over Usenet markers and waiter lists against a real MySQL,
 * with the rows production held on 2026-10-07.
 *
 * Three waiter lists were stored that day, each holding one account's
 * Real-Debrid credentials, behind markers that had read `pending` since
 * 2026-09-17..22. Two of those jobs had been deleted in nzb2rd on 2026-09-22,
 * which nzb2rd serves as their last stage with `deleted: 1` for good, and
 * nothing in DMM read that flag. The third job was genuinely queued, 24th of
 * 1188. (`fixtures/transfers/waiter-markers-2026-10-07.json`.)
 *
 * What only a real server can show: the sample's JSON filter and `RAND()`, and
 * a prune conditioned on `updatedAt` matching a `datetime(3)` read back through
 * Prisma.
 *
 * Needs Docker. Skipped without it, like the other integration tests.
 */
import recorded from '@/test/fixtures/transfers/waiter-markers-2026-10-07.json';
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

// dmmdb's own DDL: `Cache`, plus what filing a completed job reads.
const DDL = readFileSync(
	path.resolve(__dirname, '../test/fixtures/mysql/filing-tables.sql'),
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

const NZB2RD = 'http://nzb2rd.test:3200';
const NOW = Date.parse(recorded.recordedAt);
const jobs = recorded.jobs as Record<string, any>;

// eslint-disable-next-line no-control-regex
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

describe.skipIf(!dockerAvailable)('Settling Usenet markers on MySQL 8.0.36 (Integration)', () => {
	let container: StartedTestContainer;
	let monitor: PrismaClient;
	let markers: typeof import('./nzb2rdMarkers');
	let repository: typeof import('./repository').repository;
	let printed: string[] = [];

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
		monitor = new PrismaClient({ datasourceUrl: url });
		for (const statement of DDL) await monitor.$executeRawUnsafe(statement);
		process.env.DATABASE_URL = url;
		process.env.NZB2RD_URL = NZB2RD;
		markers = await import('./nzb2rdMarkers');
		({ repository } = await import('./repository'));
	}, 240_000);

	afterAll(async () => {
		await repository?.disconnect();
		await monitor?.$disconnect();
		await container?.stop();
	});

	beforeEach(async () => {
		for (const table of ['Cache', 'Available', 'AvailableFile']) {
			await monitor.$executeRawUnsafe(`DELETE FROM \`${table}\``);
		}
		// The rows as production stored them, `updatedAt` included.
		for (const marker of recorded.markers) {
			await monitor.cache.create({
				data: {
					key: `nzbrd:${marker.releaseId}`,
					value: marker,
					updatedAt: new Date(marker.updatedAt),
				},
			});
		}
		for (const [releaseId, waiters] of Object.entries(recorded.waiters)) {
			await monitor.cache.create({
				data: {
					key: `nzbwait:${releaseId}`,
					value: { waiters },
					updatedAt: new Date(Math.max(...waiters.map((w) => w.queuedAt))),
				},
			});
		}
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				const job = jobs[decodeURIComponent(url.slice(`${NZB2RD}/jobs/`.length))];
				if (!job) return { ok: false, status: 404, json: async () => ({}) };
				return { ok: true, status: 200, json: async () => ({ ...job }) };
			})
		);
		printed = [];
		vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
			printed.push(stripAnsi(args.map(String).join(' ')));
		});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	const keys = async () =>
		(await monitor.cache.findMany({ select: { key: true }, orderBy: { key: 'asc' } })).map(
			(row) => row.key
		);
	const statusOf = async (releaseId: string) =>
		((await monitor.cache.findUnique({ where: { key: `nzbrd:${releaseId}` } }))?.value as any)
			?.status;

	it('samples only markers that still read pending', async () => {
		await repository.recordNzb2rdTransferFailed('ix:release-1', 'nzb2rd-W1', 'tt6439752');

		const sample = await repository.sampleNzb2rdPendingMarkers(50);

		expect(sample.map((m) => m.releaseId).sort()).toEqual([
			'ix:release-2',
			'ix:release-3',
			'ix:release-4',
			'ix:release-5',
		]);
		expect(await repository.sampleNzb2rdPendingMarkers(2)).toHaveLength(2);
	});

	it('leaves only the queued job’s marker and waiter list after one tick', async () => {
		const result = await markers.reconcileNzb2rdMarkers({ now: NOW, markerBatch: 50 });

		expect(await keys()).toEqual([
			'nzbrd:ix:release-3',
			'nzbrd:ix:release-5',
			'nzbwait:ix:release-3',
		]);
		expect(await statusOf('ix:release-3')).toBe('pending');
		// Completed and deleted afterwards: the torrent is in RD, so it is recorded.
		expect(await statusOf('ix:release-5')).toBe('completed');
		expect(result).toMatchObject({
			waiterLists: 3,
			checked: 5,
			removed: 3,
			completed: 1,
			live: 1,
			unknown: 0,
		});
		expect(printed.filter((line) => line.startsWith('prisma:'))).toEqual([]);
	});

	it('drops a waiting account past the ceiling while its job is still queued', async () => {
		const queuedAt = recorded.waiters['ix:release-3'][0].queuedAt;

		const result = await markers.reconcileNzb2rdMarkers({
			now: queuedAt + markers.WAITER_MAX_AGE_MS,
			markerBatch: 0,
		});

		expect(result.expiredWaiters).toBe(3);
		expect((await keys()).filter((key) => key.startsWith('nzbwait:'))).toEqual([]);
		// The marker stays: only the stored credentials had a deadline.
		expect(await statusOf('ix:release-3')).toBe('pending');
	});

	it('does not prune a list someone joined after it was read', async () => {
		const [list] = (await repository.listNzb2rdWaiterLists(25)).filter(
			(l) => l.releaseId === 'ix:release-3'
		);
		await repository.addNzb2rdWaiter('ix:release-3', 'FIXTURE-LATE-JOINER', 'tt0227005');

		expect(await repository.pruneNzb2rdWaiters('ix:release-3', [], list.updatedAt)).toBe(false);
		expect((await repository.getNzb2rdWaiters('ix:release-3')).map((w) => w.rdKey)).toEqual([
			recorded.waiters['ix:release-3'][0].rdKey,
			'FIXTURE-LATE-JOINER',
		]);

		const [reread] = (await repository.listNzb2rdWaiterLists(25)).filter(
			(l) => l.releaseId === 'ix:release-3'
		);
		expect(await repository.pruneNzb2rdWaiters('ix:release-3', [], reread.updatedAt)).toBe(
			true
		);
		expect(await repository.getNzb2rdWaiters('ix:release-3')).toEqual([]);
	});

	it('keeps the rest of a list when only its oldest account expires', async () => {
		await repository.addNzb2rdWaiter('ix:release-3', 'FIXTURE-LATE-JOINER', 'tt0227005');
		const queuedAt = recorded.waiters['ix:release-3'][0].queuedAt;

		const result = await markers.reconcileNzb2rdMarkers({
			now: queuedAt + markers.WAITER_MAX_AGE_MS,
			markerBatch: 0,
		});

		expect(result.expiredWaiters).toBe(3);
		expect((await repository.getNzb2rdWaiters('ix:release-3')).map((w) => w.rdKey)).toEqual([
			'FIXTURE-LATE-JOINER',
		]);
	});
});
