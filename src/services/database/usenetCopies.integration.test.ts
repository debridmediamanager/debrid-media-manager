// @vitest-environment node
/**
 * The `nzbalt:` lists of a release's other postings, against a real MySQL.
 *
 * A fresh search writes every list it found in one multi-row INSERT … ON
 * DUPLICATE KEY UPDATE, which no mocked Prisma can check: that the JSON goes in
 * as JSON, that a second write replaces the first, and that the prune leaves
 * every other `Cache` row alone.
 *
 * Needs Docker. Skipped without it, like the other integration tests.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import path from 'path';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Nzb2rdMapService } from './nzb2rdMap';

let dockerAvailable = false;
try {
	const { getContainerRuntimeClient } = await import('testcontainers');
	await getContainerRuntimeClient();
	dockerAvailable = true;
} catch {
	dockerAvailable = false;
}

const CACHE_DDL = readFileSync(
	path.resolve(__dirname, '../../test/fixtures/mysql/filing-tables.sql'),
	'utf8'
)
	.split(/^;$/m)
	.map((statement) => statement.trim())
	.find((statement) => statement.startsWith('CREATE TABLE `Cache`'))!;

const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!dockerAvailable)('Usenet copy lists against MySQL 8.0.36 (Integration)', () => {
	let container: StartedTestContainer;
	let monitor: PrismaClient;
	let service: Nzb2rdMapService;
	let TTL: number;

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
		await monitor.$executeRawUnsafe(CACHE_DDL);
		process.env.DATABASE_URL = url;
		const map = await import('./nzb2rdMap');
		service = new map.Nzb2rdMapService();
		TTL = map.USENET_COPIES_TTL_MS;
	}, 240_000);

	afterAll(async () => {
		await service?.disconnect();
		await monitor?.$disconnect();
		await container?.stop();
	});

	beforeEach(async () => {
		await monitor.$executeRawUnsafe('DELETE FROM `Cache`');
	});

	it('writes a whole search in one statement and reads each list back by id', async () => {
		const copies = new Map(
			Array.from({ length: 300 }, (_, i) => [`ds:${i}`, [`ah:${i}`, `ds:${i + 1}`]])
		);
		copies.set('ah:B12393C9', ['ds:6b6440fd']);

		await service.recordCopies(copies);

		expect(await monitor.cache.count()).toBe(301);
		expect(await service.getCopies('ds:7')).toEqual(['ah:7', 'ds:8']);
		// Keyed case-insensitively, like the `nzbrd:` markers.
		expect(await service.getCopies('ah:b12393c9')).toEqual(['ds:6b6440fd']);
		const row = await monitor.cache.findUnique({ where: { key: 'nzbalt:ah:b12393c9' } });
		expect(row?.value).toEqual(['ds:6b6440fd']);
		expect(await service.getCopies('ds:unknown')).toEqual([]);
	});

	it('replaces a list a later search wrote again, and moves its date', async () => {
		const old = new Date(Date.now() - 3 * DAY);
		await service.recordCopies(new Map([['ds:a', ['ah:b', 'ah:c']]]), old);

		await service.recordCopies(new Map([['ds:a', ['ah:c']]]));

		expect(await service.getCopies('ds:a')).toEqual(['ah:c']);
		const row = await monitor.cache.findUnique({ where: { key: 'nzbalt:ds:a' } });
		expect(Date.now() - row!.updatedAt.getTime()).toBeLessThan(60_000);
	});

	it('reads nothing from a list older than a week', async () => {
		await service.recordCopies(new Map([['ds:a', ['ah:b']]]), new Date(Date.now() - TTL - DAY));

		expect(await service.getCopies('ds:a')).toEqual([]);
	});

	it('prunes only the lists last written before the cutoff, and nothing else', async () => {
		const old = new Date(Date.now() - TTL - DAY);
		await service.recordCopies(new Map([['ds:old', ['ah:b']]]), old);
		await service.recordCopies(new Map([['ds:new', ['ah:b']]]));
		await monitor.cache.create({
			data: { key: 'nzbrd:ds:old', value: { status: 'failed' }, updatedAt: old },
		});

		expect(await service.pruneCopies(new Date(Date.now() - TTL))).toBe(1);

		const keys = (await monitor.cache.findMany()).map((row) => row.key).sort();
		expect(keys).toEqual(['nzbalt:ds:new', 'nzbrd:ds:old']);
	});
});
