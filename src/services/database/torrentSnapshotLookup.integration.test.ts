// @vitest-environment node
/**
 * getSnapshotsByHashes against a real MySQL, with a post re-dating the release's
 * row between its two reads.
 *
 * The lookup finds each hash's newest addedDate, then reads the rows on those
 * dates. A row's addedDate is fixed by its id (hash:YYYY-MM-DD) except for a
 * post whose Added does not parse: the route then dates it by the clock, so each
 * such post moves the same row's addedDate. Read separately, the second read
 * asks for a date the row no longer has and the release looks unprobed. Both
 * reads run in one REPEATABLE READ transaction, so the second sees the
 * snapshot the first did.
 *
 * The update is forced between the reads rather than left to timing: the
 * transaction's client is wrapped so the other connection commits the update
 * as soon as the first read returns.
 *
 * Needs Docker. Skipped without it, like the other integration tests.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import path from 'path';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TorrentSnapshotService } from './torrentSnapshot';

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

const HASH = 'c'.repeat(40);
const FIRST_DATED = new Date('2026-01-03T00:00:00Z');
const REDATED = new Date('2026-01-04T00:00:00Z');

describe.skipIf(!dockerAvailable)('Snapshot lookup on MySQL 8.0.36 (Integration)', () => {
	let container: StartedTestContainer;
	let client: PrismaClient;
	/** The connection a concurrent post writes on. */
	let other: PrismaClient;

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
		client = new PrismaClient({ datasourceUrl: url });
		other = new PrismaClient({ datasourceUrl: url });
		for (const statement of DDL) await other.$executeRawUnsafe(statement);
	}, 240_000);

	afterAll(async () => {
		await Promise.all([client, other].map((c) => c?.$disconnect()));
		await container?.stop();
	});

	beforeEach(async () => {
		vi.restoreAllMocks();
		await other.$executeRawUnsafe('TRUNCATE TABLE `TorrentSnapshot`');
		await other.$executeRaw`INSERT INTO TorrentSnapshot (id, hash, addedDate, payload, updatedAt)
			VALUES (${`${HASH}:bad-added`}, ${HASH}, ${FIRST_DATED}, ${JSON.stringify({ Hash: HASH })}, NOW(3))`;
	});

	const redate = () =>
		other.$executeRaw`UPDATE TorrentSnapshot SET addedDate = ${REDATED} WHERE hash = ${HASH}`;

	/** The tx client the lookup gets, with the re-dating committed right after its first read. */
	const redatingAfterFirstRead = (tx: any) => ({
		torrentSnapshot: {
			groupBy: async (args: unknown) => {
				const newest = await tx.torrentSnapshot.groupBy(args);
				await redate();
				return newest;
			},
			findMany: (args: unknown) => tx.torrentSnapshot.findMany(args),
		},
	});

	const service = () => {
		const s = new TorrentSnapshotService();
		(s as any).prisma = client;
		return s;
	};

	it('finds a row re-dated between its two reads', async () => {
		const run = client.$transaction.bind(client) as any;
		vi.spyOn(client, '$transaction').mockImplementation(((fn: any, options: any) =>
			run((tx: any) => fn(redatingAfterFirstRead(tx)), options)) as any);

		const found = await service().getSnapshotsByHashes([HASH]);

		expect(found.map((row) => row.hash)).toEqual([HASH]);
		// The update did land: it is the transaction that kept the first read's view.
		const [stored] = await other.torrentSnapshot.findMany({ where: { hash: HASH } });
		expect(stored.addedDate).toEqual(REDATED);
	});

	it('loses that row when the two reads are not in one transaction', async () => {
		// The lookup as it would be without the transaction: each read on its own.
		vi.spyOn(client, '$transaction').mockImplementation(((fn: any) =>
			fn(redatingAfterFirstRead(client))) as any);

		const found = await service().getSnapshotsByHashes([HASH]);

		expect(found).toEqual([]);
	});
});
