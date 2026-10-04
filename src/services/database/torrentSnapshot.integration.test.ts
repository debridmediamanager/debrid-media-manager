// @vitest-environment node
/**
 * zurg snapshot posts against a real MySQL, two of them for one release at once.
 *
 * Prisma's upsert on MySQL reads the row, then creates or updates it. Two posts
 * of one release that both read before either has created the row both create
 * it, and the second fails on the key: `P2002 Unique constraint failed on the
 * constraint: PRIMARY`. Over 2026-09-21..10-04 that answered 179 posts with a
 * 500. Each of the three still in the replica logs on 2026-10-04 (23:27:11,
 * 01:18:40, 01:19:48 UTC) came paired in the proxy log with a 201 from the same
 * client in the same second, and dmmdb holds exactly one row created at each of
 * those instants and never updated: the post that won.
 *
 * The posts are the real snapshot zurg 0.11.0 sent (the route tests' fixture)
 * and the table is dmmdb's own DDL on the server version it runs. The first
 * post is held mid-create by a second client, the way another replica's create
 * is in flight, until InnoDB shows the post under test waiting on its key; the
 * interleaving is forced rather than left to timing.
 *
 * Needs Docker. Skipped without it, like the other integration tests.
 */
import snapshot from '@/test/fixtures/torrentSnapshot/zurg-direct-0.11.0.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { TorrentSnapshot, toStoredSnapshot } from '@/utils/torrentSnapshot';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import type { NextApiHandler } from 'next';
import path from 'path';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let dockerAvailable = false;
try {
	const { getContainerRuntimeClient } = await import('testcontainers');
	await getContainerRuntimeClient();
	dockerAvailable = true;
} catch {
	dockerAvailable = false;
}

const DDL = readFileSync(
	path.resolve(__dirname, '../../test/fixtures/mysql/torrent-snapshot-table.sql'),
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

// What the route derives from the post: the release's hash and the day it was added.
const ID = `${snapshot.Hash}:${snapshot.Added.slice(0, 10)}`;
const STORED = toStoredSnapshot(TorrentSnapshot.parse(snapshot));

describe.skipIf(!dockerAvailable)('Torrent snapshot saves on MySQL 8.0.36 (Integration)', () => {
	let container: StartedTestContainer;
	/** Another replica, whose create of the same row is in flight. */
	let other: PrismaClient;
	let monitor: PrismaClient;
	let handler: NextApiHandler;

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
		other = new PrismaClient({ datasourceUrl: url });
		monitor = new PrismaClient({ datasourceUrl: url });
		for (const statement of DDL) await monitor.$executeRawUnsafe(statement);
		const [settings] = await monitor.$queryRaw<{ isolation: string }[]>`
			SELECT @@transaction_isolation AS isolation`;
		expect(settings.isolation).toBe('REPEATABLE-READ');
		// The route's repository builds the app's one Prisma client from
		// DATABASE_URL when it is first imported, so it is imported only now.
		process.env.DATABASE_URL = `${url}?connection_limit=20`;
		({ default: handler } = await import('@/pages/api/torrents/snapshot'));
	}, 240_000);

	afterAll(async () => {
		await Promise.all([other, monitor].map((c) => c?.$disconnect()));
		await container?.stop();
	});

	beforeEach(async () => {
		await monitor.$executeRawUnsafe('TRUNCATE TABLE `TorrentSnapshot`');
	});

	const post = async (body: unknown) => {
		const res = createMockResponse();
		await handler(createMockRequest({ method: 'POST', body }), res);
		return { status: res._getStatusCode(), body: res._getData() };
	};
	const rows = () =>
		monitor.torrentSnapshot.findMany({
			where: { hash: snapshot.Hash },
			orderBy: { id: 'asc' },
		});

	// Not information_schema.INNODB_TRX: InnoDB refreshes that table only after
	// 100 ms without a read, so polling it faster keeps showing a stale moment.
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
				throw new Error(`no post ever waited on the other create's key (wanted ${n})`);
			}
			await new Promise((r) => setTimeout(r, 10));
		}
	};

	it('stores a post the route writes, on the test database', async () => {
		expect(await post(snapshot)).toEqual({ status: 201, body: { success: true, id: ID } });
		const [row] = await rows();
		expect(row.id).toBe(ID);
		expect(row.payload).toEqual(STORED);
	});

	it('stores a release another post is creating instead of answering 500', async () => {
		const firstWrittenAt = new Date(Date.now() - 60_000);
		let held!: () => void;
		const holding = new Promise<void>((resolve) => (held = resolve));
		const firstPost = other.$transaction(
			async (tx) => {
				await tx.$executeRaw`INSERT INTO TorrentSnapshot (id, hash, addedDate, payload, updatedAt)
					VALUES (${ID}, ${snapshot.Hash}, ${new Date(ID.slice(41))},
						${JSON.stringify(STORED)}, ${firstWrittenAt})`;
				held();
				await untilLockWaiters(1);
			},
			{ timeout: 60_000 }
		);
		await holding;

		const [first, second] = await Promise.allSettled([firstPost, post(snapshot)]);

		expect(first.status).toBe('fulfilled');
		expect(second).toEqual({
			status: 'fulfilled',
			value: { status: 201, body: { success: true, id: ID } },
		});
		const stored = await rows();
		expect(stored).toHaveLength(1);
		expect(stored[0].payload).toEqual(STORED);
		// The second post wrote too, rather than being dropped as a duplicate.
		expect(stored[0].updatedAt.getTime()).toBeGreaterThan(firstWrittenAt.getTime());
	});

	it('answers every post of a release several replicas receive at once', async () => {
		const answers = await Promise.all(Array.from({ length: 8 }, () => post(snapshot)));

		expect(answers.map((a) => a.status)).toEqual(Array(8).fill(201));
		const stored = await rows();
		expect(stored.map((r) => r.id)).toEqual([ID]);
		expect(stored[0].payload).toEqual(STORED);
	});
});
