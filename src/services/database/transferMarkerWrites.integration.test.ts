// @vitest-environment node
/**
 * What one poll of the Transfers page writes to `Cache`, against a real MySQL,
 * with the markers production rewrote.
 *
 * `/api/transfers` is polled every 5 seconds and hands every failed and
 * completed Usenet row on the account to the marker recorders. Both wrote the
 * marker back whatever it already said, and the failed one dropped the
 * release's waiter list each time too: 10,168 marker writes between 16:47 and
 * 16:57 UTC on 2026-10-07, spread over 201 markers, each up to 117 times.
 *
 * Writing only a change also stops the worst of those rewrites: a failed row
 * for an old job put its failure back over the marker of the Retry that
 * replaced it, on every poll. On 2026-10-07, 11 releases read `failed` for an
 * old job while their newest job was still queued in nzb2rd.
 *
 * The rows are production's (`fixtures/transfers/failed-marker-polls-2026-10-07.json`
 * and `marker-polls-2026-10-07.json`), and writes are counted by the server's
 * own statement counters, so a write the route makes through any path counts.
 *
 * Needs Docker. Skipped without it, like the other integration tests.
 */
import failedPolls from '@/test/fixtures/transfers/failed-marker-polls-2026-10-07.json';
import recorded from '@/test/fixtures/transfers/marker-polls-2026-10-07.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
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

// The route files and records without awaiting either; these let a poll be
// waited out before its writes are counted.
const inflight = vi.hoisted(() => {
	const pending = new Set<Promise<unknown>>();
	return {
		track<T>(promise: Promise<T>): Promise<T> {
			pending.add(promise);
			promise.then(
				() => pending.delete(promise),
				() => pending.delete(promise)
			);
			return promise;
		},
		async settle() {
			while (pending.size > 0) await Promise.allSettled([...pending]);
		},
	};
});

vi.mock('@/services/transferList', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/transferList')>();
	return { ...actual, listTransfers: vi.fn() };
});
vi.mock('@/services/transferRegistration', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/transferRegistration')>();
	return {
		...actual,
		registerCompletedNzb2rdJob: (
			...args: Parameters<typeof actual.registerCompletedNzb2rdJob>
		) => inflight.track(actual.registerCompletedNzb2rdJob(...args)),
	};
});
vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>();
	return { ...actual, withIpRateLimit: (handler: unknown) => handler };
});

const DDL = readFileSync(
	path.resolve(__dirname, '../../test/fixtures/mysql/filing-tables.sql'),
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

type Job = Record<string, any>;

/** A failed job as nzb2rd lists it, from what its production marker recorded. */
const failedJobOf = (marker: (typeof failedPolls.markers)[number]): Job => ({
	id: marker.jobId,
	status: 'failed',
	error: marker.error,
	imdb_id: marker.imdbId,
	nzb_name: `${marker.title}.nzb`,
	name: null,
	created_at: '2026-10-06 12:00:00',
});

describe.skipIf(!dockerAvailable)('Transfers polls against MySQL 8.0.36 (Integration)', () => {
	let container: StartedTestContainer;
	let monitor: PrismaClient;
	let handler: typeof import('@/pages/api/transfers').default;
	let repository: typeof import('@/services/repository').repository;
	let transferList: typeof import('@/services/transferList');

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
		({ repository } = await import('@/services/repository'));
		transferList = await import('@/services/transferList');
		handler = (await import('@/pages/api/transfers')).default;
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
		const record = repository.recordNzb2rdTransferFailed.bind(repository);
		vi.spyOn(repository, 'recordNzb2rdTransferFailed').mockImplementation((...args) =>
			inflight.track(record(...args))
		);
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	/** INSERT, UPDATE and DELETE statements the server has run, on any connection. */
	const writeStatements = async () => {
		const rows = await monitor.$queryRawUnsafe<{ Variable_name: string; Value: string }[]>(
			"SHOW GLOBAL STATUS WHERE Variable_name IN ('Com_insert', 'Com_update', 'Com_delete', 'Com_replace', 'Com_insert_select', 'Com_update_multi', 'Com_delete_multi')"
		);
		return rows.reduce((sum, row) => sum + Number(row.Value), 0);
	};

	/** One poll of the Transfers page listing `jobs`, and the writes it made. */
	const poll = async (jobs: Job[]) => {
		const rows = jobs.map(transferList.nzb2rdRowOf);
		vi.mocked(transferList.listTransfers).mockResolvedValue({
			transfers: rows,
			raw: new Map(rows.map((row, i) => [transferList.keyOf(row), jobs[i]])),
			degraded: [],
			next: null,
		});
		const before = await writeStatements();
		const res = createMockResponse();
		await handler(
			createMockRequest({ method: 'GET', headers: { 'x-rd-api-key': 'rd-key' }, query: {} }),
			res
		);
		expect(res.status).toHaveBeenCalledWith(200);
		await inflight.settle();
		return (await writeStatements()) - before;
	};

	const marker = async (releaseId: string) =>
		(await monitor.cache.findUnique({ where: { key: `nzbrd:${releaseId}` } }))?.value as any;

	const seedMeta = async (meta: {
		jobId: string;
		releaseId: string;
		title: string;
		imdbId: string;
		returnPath?: string;
	}) => repository.recordTransferMeta({ source: 'nzb2rd', ...meta });

	it('records a page of failed rows once, then writes nothing on the polls after', async () => {
		for (const m of failedPolls.markers) {
			await repository.recordNzb2rdTransferPending(m.releaseId, m.jobId, m.imdbId, m.title);
			await seedMeta({
				jobId: m.jobId,
				releaseId: m.releaseId,
				title: m.title,
				imdbId: m.imdbId,
			});
		}
		const jobs = failedPolls.markers.map(failedJobOf);

		// The state change: each marker goes pending → failed, waiter list dropped.
		expect(await poll(jobs)).toBeGreaterThan(0);
		const after = await Promise.all(failedPolls.markers.map((m) => marker(m.releaseId)));

		for (let i = 0; i < 4; i++) expect(await poll(jobs)).toBe(0);

		for (const [i, m] of failedPolls.markers.entries()) {
			expect(await marker(m.releaseId)).toEqual(after[i]);
			expect(after[i]).toMatchObject({ status: 'failed', error: m.error, title: m.title });
		}
	});

	it('writes nothing for completed rows that are already recorded and filed', async () => {
		for (const { job, marker: m, transferMeta } of recorded.completed) {
			await monitor.cache.create({
				data: { key: `nzbrd:${m.releaseId}`, value: m, updatedAt: new Date(m.updatedAt) },
			});
			await seedMeta(transferMeta);
			await monitor.$executeRaw`INSERT INTO Available (hash, imdbId, filename, originalFilename, bytes, originalBytes, host, progress, status, ended, updatedAt) VALUES (${job.info_hash}, ${job.imdb_id}, ${m.title}, ${m.title}, 1, 1, 'real-debrid.com', 100, 'downloaded', NOW(3), NOW(3))`;
		}
		const jobs = recorded.completed.map((c) => c.job);

		for (let i = 0; i < 3; i++) expect(await poll(jobs)).toBe(0);

		for (const { marker: m } of recorded.completed) {
			expect(await marker(m.releaseId)).toEqual(m);
		}
	});

	it('still records a completion the first time a poll sees it', async () => {
		for (const { job, marker: m, transferMeta } of recorded.completed) {
			await repository.recordNzb2rdTransferPending(
				m.releaseId,
				job.id,
				job.imdb_id,
				transferMeta.title
			);
			await seedMeta(transferMeta);
			await monitor.$executeRaw`INSERT INTO Available (hash, imdbId, filename, originalFilename, bytes, originalBytes, host, progress, status, ended, updatedAt) VALUES (${job.info_hash}, ${job.imdb_id}, ${m.title}, ${m.title}, 1, 1, 'real-debrid.com', 100, 'downloaded', NOW(3), NOW(3))`;
		}
		const jobs = recorded.completed.map((c) => c.job);

		expect(await poll(jobs)).toBe(recorded.completed.length);
		expect(await poll(jobs)).toBe(0);

		for (const { marker: m } of recorded.completed) {
			expect(await marker(m.releaseId)).toMatchObject({
				status: 'completed',
				jobId: m.jobId,
				infoHash: m.infoHash,
				title: m.title,
			});
		}
	});

	// A Retry records its new job on the marker, and the old failed row stays on
	// the submitter's page. Its failure used to go back over the retry's marker,
	// and take the retry's waiter list with it, on every poll.
	it('leaves a retry’s pending marker and its waiters alone while the old failed row is listed', async () => {
		const { oldJob, newJob, marker: was, transferMeta } = recorded.retry;
		for (const meta of transferMeta) await seedMeta(meta);
		await repository.recordNzb2rdTransferPending(
			was.releaseId,
			newJob.id,
			was.imdbId,
			was.title
		);
		await repository.addNzb2rdWaiter(was.releaseId, 'FIXTURE-WAITING-ACCOUNT', was.imdbId);
		const pending = await marker(was.releaseId);

		for (let i = 0; i < 3; i++) expect(await poll([newJob, oldJob])).toBe(0);

		expect(await marker(was.releaseId)).toEqual(pending);
		expect((await repository.getNzb2rdWaiters(was.releaseId)).map((w) => w.rdKey)).toEqual([
			'FIXTURE-WAITING-ACCOUNT',
		]);
	});

	it('records the retry’s own failure when it comes', async () => {
		const { oldJob, newJob, marker: was, transferMeta } = recorded.retry;
		for (const meta of transferMeta) await seedMeta(meta);
		await repository.recordNzb2rdTransferPending(
			was.releaseId,
			newJob.id,
			was.imdbId,
			was.title
		);
		const failedRetry = { ...newJob, status: 'failed', error: 'par2 exited 2' };

		expect(await poll([failedRetry, oldJob])).toBeGreaterThan(0);
		expect(await marker(was.releaseId)).toMatchObject({
			status: 'failed',
			jobId: newJob.id,
			error: 'par2 exited 2',
		});
		expect(await poll([failedRetry, oldJob])).toBe(0);
	});
});
