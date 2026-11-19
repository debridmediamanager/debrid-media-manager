// @vitest-environment node
/**
 * The wanted history against a real MySQL, built by the migration itself.
 *
 * What no mocked Prisma can check: that the migration applies to the table before it,
 * that the unique (itemId, key) tells `a1` from `A1` (the table's collation is
 * case-insensitive, the key's alphabet is not), that a resent event is dropped rather
 * than failing its batch, and that the grouped hints read counts distinct sponsors.
 *
 * Needs Docker. Skipped without it, like the other integration tests.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import path from 'path';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WantedEventInput, WantedEventsService } from './wantedEvents';
import type { WantedItemsService } from './wantedItems';

let dockerAvailable = false;
try {
	const { getContainerRuntimeClient } = await import('testcontainers');
	await getContainerRuntimeClient();
	dockerAvailable = true;
} catch {
	dockerAvailable = false;
}

/** `WantedItem` as production had it before this migration (20261107_wanted_pins). */
const WANTED_ITEM_BEFORE = `CREATE TABLE \`WantedItem\` (
	\`id\` VARCHAR(191) NOT NULL,
	\`shortId\` VARCHAR(16) NOT NULL,
	\`imdbId\` VARCHAR(16) NOT NULL,
	\`kind\` VARCHAR(8) NOT NULL,
	\`title\` VARCHAR(512) NOT NULL,
	\`seasons\` JSON NULL,
	\`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	\`fulfilledAt\` DATETIME(3) NULL,
	\`fulfilled\` JSON NULL,
	\`lastPolledAt\` DATETIME(3) NULL,
	\`pins\` JSON NULL,
	UNIQUE INDEX \`WantedItem_shortId_imdbId_key\`(\`shortId\`, \`imdbId\`),
	PRIMARY KEY (\`id\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;

const MIGRATION = readFileSync(
	path.resolve(__dirname, '../../../prisma/migrations/20261119_wanted_events/migration.sql'),
	'utf8'
)
	.replace(/^--.*$/gm, '')
	.split(';')
	.map((statement) => statement.trim())
	.filter(Boolean);

const ITEM = '0b7c2f8e-1d1f-4a55-9c3a-6c9d8e7f1a2b';
const THEIRS = '5d1e2f8e-1d1f-4a55-9c3a-6c9d8e7f1a2b';
const IMDB = 'tt0115082';
const HASH = 'b'.repeat(40);
const SHA = 'a'.repeat(64);
const HELD = 'c'.repeat(64);

const event = (over: Partial<WantedEventInput> = {}): WantedEventInput => ({
	itemId: ITEM,
	key: 'k1',
	at: new Date('2026-11-19T11:00:00Z'),
	kind: 'grabbed',
	reason: '',
	detail: '',
	release: 'Show.S01E07.1080p.WEB.h264-GRP',
	torrent: true,
	hash: HASH,
	nzb: null,
	dmmId: null,
	size: 5_000_000_000,
	posted: null,
	season: 1,
	episode: 7,
	pack: false,
	resolution: '1080p',
	...over,
});

describe.skipIf(!dockerAvailable)('Wanted history against MySQL 8.0.36 (Integration)', () => {
	let container: StartedTestContainer;
	let monitor: PrismaClient;
	let service: WantedEventsService;
	let items: WantedItemsService;

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
		await monitor.$executeRawUnsafe(WANTED_ITEM_BEFORE);
		for (const statement of MIGRATION) await monitor.$executeRawUnsafe(statement);
		process.env.DATABASE_URL = url;
		service = new (await import('./wantedEvents')).WantedEventsService();
		items = new (await import('./wantedItems')).WantedItemsService();
	}, 240_000);

	afterAll(async () => {
		await service?.disconnect();
		await items?.disconnect();
		await monitor?.$disconnect();
		await container?.stop();
	});

	beforeEach(async () => {
		for (const table of ['WantedEvent', 'WantedNzb', 'WantedItem']) {
			await monitor.$executeRawUnsafe(`DELETE FROM \`${table}\``);
		}
		await monitor.wantedItem.createMany({
			data: [
				{ id: ITEM, shortId: 'AAAA', imdbId: IMDB, kind: 'show', title: '3rd Rock' },
				{ id: THEIRS, shortId: 'BBBB', imdbId: IMDB, kind: 'show', title: '3rd Rock' },
			],
		});
	});

	const owned = (shortId: string) => service.owned(shortId, [ITEM, THEIRS]);

	it("owns only the sponsor's own items", async () => {
		expect([...(await owned('AAAA')).keys()]).toEqual([ITEM]);
		expect([...(await owned('CCCC')).keys()]).toEqual([]);
	});

	it('stores an event once under its item and key, telling keys apart by case', async () => {
		const mine = await owned('AAAA');
		expect(await service.record('AAAA', mine, [event(), event({ key: 'K1' })])).toBe(2);
		// Resent with one new event: the batch goes through and only the new one is stored.
		expect(
			await service.record('AAAA', mine, [
				event(),
				event({ key: 'K1' }),
				event({ key: 'k2' }),
			])
		).toBe(1);
		expect(await monitor.wantedEvent.count()).toBe(3);
		// The same key under another item is another event.
		expect(await service.record('BBBB', await owned('BBBB'), [event({ itemId: THEIRS })])).toBe(
			1
		);
	});

	it('keeps a snapshot off the list zurg polls and on the one the website reads', async () => {
		await service.setProgress('AAAA', ITEM, [{ season: 1, have: [1, 2], missing: [7] }]);
		// Not theirs to write.
		await service.setProgress('BBBB', ITEM, [{ season: 9, have: [], missing: [] }]);

		const [site] = await items.list('AAAA');
		expect(site.progress).toEqual([{ season: 1, have: 2, missing: [7] }]);
		const [polled] = await items.list('AAAA', undefined, false);
		expect(polled).not.toHaveProperty('progress');
		expect(polled.id).toBe(ITEM);
		expect((await service.history('AAAA', ITEM))!.seasons).toEqual([
			{ season: 1, have: [1, 2], missing: [7] },
		]);
		expect(await service.history('BBBB', ITEM)).toBeNull();
	});

	it('answers history newest first, without another sponsor’s events', async () => {
		await service.record('AAAA', await owned('AAAA'), [
			event({ key: 'old', at: new Date('2026-11-18T00:00:00Z') }),
			event({ key: 'new', kind: 'failed', reason: 'nothing_found', release: '', hash: null }),
		]);
		await service.record('BBBB', await owned('BBBB'), [event({ itemId: THEIRS })]);
		const history = await service.history('AAAA', ITEM);
		expect(history!.events.map((e) => e.kind)).toEqual(['failed', 'grabbed']);
		expect(history!.events[1].size).toBe(5_000_000_000);
	});

	it('groups a title’s releases across sponsors for the hints', async () => {
		const a = await owned('AAAA');
		const b = await owned('BBBB');
		await service.record('AAAA', a, [
			event(),
			// Twice by one sponsor is still one taker.
			event({ key: 'k1-again' }),
			event({
				key: 'nzb',
				torrent: false,
				hash: null,
				nzb: SHA,
				dmmId: 'ds:native-1',
				episode: 8,
			}),
			event({ key: 'up', torrent: false, hash: null, nzb: HELD, episode: 9 }),
			event({
				key: 'bad',
				kind: 'rejected',
				reason: 'missing_articles',
				torrent: false,
				hash: null,
				nzb: 'd'.repeat(64),
			}),
			// One zurg's own taste is never shared.
			event({ key: 'taste', kind: 'rejected', reason: 'quality', hash: 'e'.repeat(40) }),
			event({
				key: 'none',
				kind: 'failed',
				reason: 'nothing_found',
				release: '',
				hash: null,
			}),
		]);
		await service.record('BBBB', b, [
			event({ itemId: THEIRS }),
			event({
				itemId: THEIRS,
				key: 'bad',
				kind: 'removed',
				reason: 'no_video',
				torrent: false,
				hash: null,
				nzb: 'd'.repeat(64),
			}),
		]);
		await service.markNzbHeld(HELD);
		await service.markNzbHeld(HELD);

		const rows = await service.hintRows([IMDB, 'tt0000001']);
		const byRef = new Map(rows.map((row) => [row.ref, row]));

		expect([...byRef.keys()].sort()).toEqual(
			[HASH, HELD, 'd'.repeat(64), 'ds:native-1'].sort()
		);
		expect(byRef.get(HASH)).toMatchObject({
			imdbId: IMDB,
			release: 'Show.S01E07.1080p.WEB.h264-GRP',
			size: 5_000_000_000,
			resolution: '1080p',
			season: 1,
			episode: 7,
			pack: false,
			taken: 2,
			refused: 0,
			lastRefused: null,
			held: false,
		});
		expect(byRef.get(HASH)!.takers.sort()).toEqual(['AAAA', 'BBBB']);
		expect(byRef.get(HASH)!.lastTaken).toBeInstanceOf(Date);
		expect(byRef.get('ds:native-1')).toMatchObject({ nzb: SHA, taken: 1, held: false });
		expect(byRef.get(HELD)).toMatchObject({ taken: 1, held: true });
		expect(byRef.get('d'.repeat(64))).toMatchObject({
			taken: 0,
			takers: [],
			refused: 2,
			lastTaken: null,
		});
		expect(await service.heldNzbs([HELD, SHA])).toEqual(new Set([HELD]));
	});

	it('takes an upload only from a sponsor who grabbed that NZB from elsewhere', async () => {
		await service.record('AAAA', await owned('AAAA'), [
			event({ key: 'own', torrent: false, hash: null, nzb: SHA }),
			event({ key: 'dmm', torrent: false, hash: null, nzb: HELD, dmmId: 'ds:native-1' }),
		]);
		expect(await service.reportedNzb('AAAA', SHA)).toBe(true);
		expect(await service.reportedNzb('BBBB', SHA)).toBe(false);
		expect(await service.reportedNzb('AAAA', HELD)).toBe(false);
	});

	it("prunes a zurg's own events after 30 days and shared ones after 180", async () => {
		await service.record('AAAA', await owned('AAAA'), [
			event({ key: 'grab' }),
			event({ key: 'taste', kind: 'rejected', reason: 'quality' }),
			event({ key: 'old-grab' }),
			event({ key: 'old-taste', kind: 'rejected', reason: 'quality' }),
			event({ key: 'ancient-grab' }),
		]);
		const day = 24 * 60 * 60_000;
		const age = (key: string, days: number) =>
			monitor.wantedEvent.updateMany({
				where: { key },
				data: { createdAt: new Date(Date.now() - days * day) },
			});
		await age('old-grab', 31);
		await age('old-taste', 31);
		await age('ancient-grab', 181);

		expect(
			await service.prune(new Date(Date.now() - 30 * day), new Date(Date.now() - 180 * day))
		).toBe(2);
		const left = await monitor.wantedEvent.findMany({ select: { key: true } });
		expect(left.map((row) => row.key).sort()).toEqual(['grab', 'old-grab', 'taste']);
	});
});
