// @vitest-environment node
/**
 * Clearing transfer markers against a real MySQL, with the polls that filled
 * production's log.
 *
 * `prisma.cache.delete` on a key with no row is P2025. Every caller here caught
 * it, so nothing failed, but Prisma prints a failed query from its own `error`
 * log before the caller sees the rejection, and dmm's client logs at that level.
 * So a delete that removed nothing printed a five-line "Invalid
 * `prisma.cache.delete()` invocation" block every time, and `.catch(() =>
 * undefined)` hid nothing but real database errors.
 *
 * Nearly all of them came from the transfers page. It is polled every 5 seconds,
 * and every poll re-records each failed Usenet row on the account, which drops
 * the release's waiter list. That row only exists while a second account is
 * queued behind a job in flight (3 of them against 852 failed markers on
 * 2026-10-07), so the drop almost never had anything to delete, and an account
 * with twenty failed rows printed twenty blocks per poll. Cancelling or pruning
 * a release that has no marker, and the debrid uploader's equivalent, took the
 * same path. In all three, finding nothing to delete is the ordinary outcome.
 *
 * The markers are three that one production poll rewrote together, and
 * `printed` is the block production logged for each
 * (`fixtures/transfers/failed-marker-polls-2026-10-07.json`).
 *
 * Needs Docker. Skipped without it, like the other integration tests.
 */
import recorded from '@/test/fixtures/transfers/failed-marker-polls-2026-10-07.json';
import clears from '@/test/fixtures/transfers/marker-clears-2026-10-09.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import path from 'path';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>();
	return { ...actual, withIpRateLimit: (handler: unknown) => handler };
});

let dockerAvailable = false;
try {
	const { getContainerRuntimeClient } = await import('testcontainers');
	await getContainerRuntimeClient();
	dockerAvailable = true;
} catch {
	dockerAvailable = false;
}

// dmmdb's own `Cache` DDL, as the filing tests load it.
const CACHE_DDL = readFileSync(
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
	.find((statement) => statement.startsWith('CREATE TABLE `Cache`'))!;

// eslint-disable-next-line no-control-regex
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

describe.skipIf(!dockerAvailable)('Clearing transfer markers on MySQL 8.0.36 (Integration)', () => {
	let container: StartedTestContainer;
	let url: string;
	let monitor: PrismaClient;
	let repository: typeof import('../repository').repository;
	let Nzb2rdMapService: typeof import('./nzb2rdMap').Nzb2rdMapService;
	let jobRoute: typeof import('@/pages/api/nzb2rd/jobs/[id]').default;

	// What Prisma prints through `log: ['warn', 'error']`, which is the app's
	// client configuration: `console.log('prisma:error', message)`.
	let printed: string[] = [];
	const prismaErrors = () => printed.filter((block) => block.startsWith('prisma:'));

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
		// The repository builds the app's one Prisma client from DATABASE_URL when
		// it is first imported.
		process.env.DATABASE_URL = url;
		({ repository } = await import('../repository'));
		({ Nzb2rdMapService } = await import('./nzb2rdMap'));
		jobRoute = (await import('@/pages/api/nzb2rd/jobs/[id]')).default;
	}, 240_000);

	afterAll(async () => {
		await repository?.disconnect();
		await monitor?.$disconnect();
		await container?.stop();
	});

	beforeEach(async () => {
		await monitor.$executeRawUnsafe('TRUNCATE TABLE `Cache`');
		printed = [];
		vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
			printed.push(stripAnsi(args.map(String).join(' ')));
		});
	});

	afterEach(() => {
		vi.mocked(console.log).mockRestore();
	});

	const keys = async () =>
		(await monitor.cache.findMany({ select: { key: true }, orderBy: { key: 'asc' } })).map(
			(row) => row.key
		);

	// The block in the fixture is what a caught `delete` of a missing row prints
	// on this Prisma and MySQL, so the absence of it below is the production line
	// going away rather than some other line.
	it('prints the production block for a caught delete of a missing row', async () => {
		const client = new PrismaClient({ datasourceUrl: url, log: ['warn', 'error'] });
		try {
			await client.cache
				.delete({ where: { key: 'nzbwait:ix:release-1' } })
				.catch(() => undefined);
		} finally {
			await client.$disconnect();
		}

		// Only the middle differs: run from source, Prisma frames the call site,
		// and the bundled production build has no source to frame, so it names
		// the generic `prisma.cache.delete()` instead.
		const [block] = prismaErrors();
		const lines = block.split('\n');
		expect(lines[0]).toBe(recorded.printed[0]);
		expect(lines[1]).toMatch(/^Invalid `.*\.delete\(\)` invocation/);
		expect(lines.at(-1)).toBe(recorded.printed.at(-1));
	});

	it('re-records a page of failed Usenet rows on every poll without printing an error', async () => {
		// A release's marker as the submit wrote it, before nzb2rd reported the
		// failure. Nobody queued behind any of them, as for nearly every release.
		for (const marker of recorded.markers) {
			await repository.recordNzb2rdTransferPending(
				marker.releaseId,
				marker.jobId,
				marker.imdbId,
				marker.title
			);
		}

		// Two polls of the transfers page, each recording every failed row the
		// way the route's `markMarkerFailed` does.
		for (let poll = 0; poll < 2; poll++) {
			for (const marker of recorded.markers) {
				await repository.recordNzb2rdTransferFailed(
					marker.releaseId,
					marker.jobId,
					marker.imdbId,
					marker.error,
					marker.title
				);
			}
		}

		expect(prismaErrors()).toEqual([]);
		for (const marker of recorded.markers) {
			expect(await repository.getNzb2rdTransfer(marker.releaseId)).toMatchObject({
				status: 'failed',
				error: marker.error,
				title: marker.title,
			});
		}
		expect(await keys()).toEqual(recorded.markers.map((m) => `nzbrd:${m.releaseId}`));
	});

	it('still drops a waiter list that is there when the job fails', async () => {
		const [marker] = recorded.markers;
		await repository.recordNzb2rdTransferPending(marker.releaseId, marker.jobId, marker.imdbId);
		await repository.addNzb2rdWaiter(marker.releaseId, 'rd-key-b', marker.imdbId);
		expect(await keys()).toContain(`nzbwait:${marker.releaseId}`);

		await repository.recordNzb2rdTransferFailed(
			marker.releaseId,
			marker.jobId,
			marker.imdbId,
			marker.error
		);

		expect(await keys()).toEqual([`nzbrd:${marker.releaseId}`]);
		expect(prismaErrors()).toEqual([]);
	});

	it('cancels a release that never had a marker without printing an error', async () => {
		await expect(
			repository.removeNzb2rdTransfer('ix:release-9', 'nzb2rd-P9')
		).resolves.toBeUndefined();
		expect(prismaErrors()).toEqual([]);
	});

	it('cancels a release with a marker and a waiter list, removing both', async () => {
		const [marker] = recorded.markers;
		await repository.recordNzb2rdTransferPending(marker.releaseId, marker.jobId, marker.imdbId);
		await repository.addNzb2rdWaiter(marker.releaseId, 'rd-key-b', marker.imdbId);

		await repository.removeNzb2rdTransfer(marker.releaseId, marker.jobId);

		expect(await keys()).toEqual([]);
		expect(prismaErrors()).toEqual([]);
	});

	it('prunes a debrid mapping that is already gone without printing an error', async () => {
		await expect(repository.removeDebridTransfer('a'.repeat(40))).resolves.toBeUndefined();
		expect(prismaErrors()).toEqual([]);
	});

	it('prunes a debrid mapping that is there', async () => {
		await repository.recordDebridTransferPending('A'.repeat(40), 'job-1', 'tt0460654');
		expect(await keys()).toEqual([`tbrd:${'a'.repeat(40)}`]);

		await repository.removeDebridTransfer('A'.repeat(40));

		expect(await keys()).toEqual([]);
		expect(prismaErrors()).toEqual([]);
	});

	// The catch-all that hid P2025 hid everything else with it: a removal that
	// could not reach the table answered as if it had worked, and the unregister
	// route told its caller `removed: true`.
	it('lets a real database error through instead of answering as if it worked', async () => {
		await monitor.$executeRawUnsafe('RENAME TABLE `Cache` TO `CacheAway`');
		try {
			await expect(
				repository.removeNzb2rdTransfer('ix:release-1', 'nzb2rd-P1')
			).rejects.toThrow();
			await expect(repository.removeDebridTransfer('a'.repeat(40))).rejects.toThrow();
		} finally {
			await monitor.$executeRawUnsafe('RENAME TABLE `CacheAway` TO `Cache`');
		}
	});

	// Delivery has to be once-only. Two polls of a completed job can read the
	// same waiter list before either clears it; only the one whose delete removed
	// the row may hand the torrent out, or each account gets it added twice.
	it('hands a waiter list to only one of two polls that read it together', async () => {
		const [marker] = recorded.markers;
		await repository.addNzb2rdWaiter(marker.releaseId, 'rd-key-b', marker.imdbId);
		await repository.addNzb2rdWaiter(marker.releaseId, 'rd-key-c', marker.imdbId);

		const service = new Nzb2rdMapService();
		const read = service.getWaiters.bind(service);
		let reads = 0;
		let bothRead!: () => void;
		const barrier = new Promise<void>((resolve) => (bothRead = resolve));
		service.getWaiters = async (releaseId: string) => {
			const waiters = await read(releaseId);
			if (++reads === 2) bothRead();
			await barrier;
			return waiters;
		};

		const [first, second] = await Promise.all([
			service.takeWaiters(marker.releaseId),
			service.takeWaiters(marker.releaseId),
		]);

		const delivered = [...first, ...second].map((w) => w.rdKey).sort();
		expect(delivered).toEqual(['rd-key-b', 'rd-key-c']);
		expect(await keys()).toEqual([]);
		expect(prismaErrors()).toEqual([]);
	});

	// A Retry records its new job on the release's marker while the old failed
	// row stays on the Transfers page, and clearing that row deleted the retry's
	// marker and everyone queued behind it. On 2026-10-10, 33 releases had a
	// retry queued in nzb2rd and no marker, so their title pages offered every
	// account a fresh Send, a second Usenet fetch of the same release.
	// (`fixtures/transfers/marker-clears-2026-10-09.json`)
	describe('clearing a Transfers row', () => {
		const { clear, oldJob, retryJob, transferMeta } = clears;
		const { releaseId, imdbId, title } = transferMeta[1];

		/** `DELETE /api/nzb2rd/jobs/:id` as the Transfers page sends it, with nzb2rd's answer. */
		const remove = async (jobId: string) => {
			const fetch = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(
					new Response(JSON.stringify(clear.nzb2rd.body), { status: clear.nzb2rd.status })
				);
			try {
				const res = createMockResponse();
				await jobRoute(
					createMockRequest({
						method: clear.method,
						headers: { 'x-rd-api-key': 'rd-key' },
						query: { ...clear.query, id: jobId },
					}),
					res
				);
				expect(res.status).toHaveBeenCalledWith(clear.nzb2rd.status);
			} finally {
				fetch.mockRestore();
			}
		};

		beforeEach(async () => {
			// What the retry's submit recorded, and an account queued behind it.
			await repository.recordNzb2rdTransferPending(releaseId, retryJob.id, imdbId, title);
			await repository.addNzb2rdWaiter(releaseId, 'FIXTURE-WAITING-ACCOUNT', imdbId);
		});

		it('leaves the retry’s marker and waiters when the old failed row is cleared', async () => {
			await remove(oldJob.id);

			expect(await repository.getNzb2rdTransfer(releaseId)).toMatchObject({
				jobId: retryJob.id,
				status: 'pending',
			});
			expect((await repository.getNzb2rdWaiters(releaseId)).map((w) => w.rdKey)).toEqual([
				'FIXTURE-WAITING-ACCOUNT',
			]);
		});

		it('still clears both when the job the marker follows is cancelled', async () => {
			await remove(retryJob.id);

			expect(await keys()).toEqual([]);
		});
	});
});
