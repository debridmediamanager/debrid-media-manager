import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { isShared, WantedEventsService, type WantedEventInput } from './wantedEvents';

const prismaMock = vi.hoisted(() => ({
	wantedItem: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
	wantedEvent: {
		createMany: vi.fn(),
		findFirst: vi.fn(),
		findMany: vi.fn(),
		deleteMany: vi.fn(),
	},
	wantedNzb: { findMany: vi.fn(), createMany: vi.fn() },
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

const ID = '0b7c2f8e-1d1f-4a55-9c3a-6c9d8e7f1a2b';
const NOW = new Date('2026-11-19T12:00:00Z');
const event = (over: Partial<WantedEventInput> = {}): WantedEventInput => ({
	itemId: ID,
	key: 'k1',
	at: new Date('2026-11-19T11:00:00Z'),
	kind: 'grabbed',
	reason: '',
	detail: '',
	release: 'Show.S01E07.1080p.WEB.h264-GRP',
	torrent: false,
	hash: null,
	nzb: 'a'.repeat(64),
	dmmId: null,
	size: 5,
	posted: null,
	season: 1,
	episode: 7,
	pack: false,
	resolution: '1080p',
	...over,
});

describe('WantedEventsService', () => {
	let service: WantedEventsService;
	beforeEach(() => {
		service = new WantedEventsService();
		for (const model of Object.values(prismaMock))
			for (const fn of Object.values(model)) (fn as Mock).mockReset();
	});

	it('shares grabs and content verdicts, and nothing else', () => {
		expect(isShared('grabbed', '')).toBe(true);
		expect(isShared('rejected', 'missing_articles')).toBe(true);
		expect(isShared('removed', 'wrong_content')).toBe(true);
		expect(isShared('rejected', 'quality')).toBe(false);
		expect(isShared('removed', 'upgraded')).toBe(false);
		expect(isShared('failed', 'nothing_found')).toBe(false);
		expect(isShared('failed', 'other')).toBe(false);
	});

	it("reads only the sponsor's own items", async () => {
		prismaMock.wantedItem.findMany.mockResolvedValue([
			{ id: ID, imdbId: 'tt0115082', kind: 'show' },
		]);
		const owned = await service.owned('ZP1M', [ID, 'other']);
		expect(prismaMock.wantedItem.findMany.mock.calls[0][0].where).toEqual({
			shortId: 'ZP1M',
			id: { in: [ID, 'other'] },
		});
		expect([...owned]).toEqual([[ID, { imdbId: 'tt0115082', kind: 'show' }]]);
	});

	it('stores each event once under its item and key, and counts the new ones', async () => {
		prismaMock.wantedEvent.createMany.mockResolvedValue({ count: 1 });
		const owned = new Map([[ID, { imdbId: 'tt0115082' }]]);
		const stored = await service.record(
			'ZP1M',
			owned,
			[
				event(),
				event({
					key: 'k2',
					kind: 'rejected',
					reason: 'quality',
					at: new Date('2027-01-01T00:00:00Z'),
				}),
				event({ itemId: 'not-theirs' }),
			],
			NOW
		);

		expect(stored).toBe(1);
		const { data, skipDuplicates } = prismaMock.wantedEvent.createMany.mock.calls[0][0];
		// The unique (itemId, key) drops a resent event instead of failing the batch.
		expect(skipDuplicates).toBe(true);
		expect(data).toHaveLength(2);
		expect(data[0]).toMatchObject({
			itemId: ID,
			key: 'k1',
			shortId: 'ZP1M',
			imdbId: 'tt0115082',
			shared: true,
			size: BigInt(5),
		});
		// A clock running ahead cannot date an event after DMM heard of it.
		expect(data[1]).toMatchObject({ shared: false, at: NOW });
	});

	it('writes nothing when no event is for an owned item', async () => {
		expect(await service.record('ZP1M', new Map(), [event()])).toBe(0);
		expect(prismaMock.wantedEvent.createMany).not.toHaveBeenCalled();
	});

	it('takes an upload only for an NZB this sponsor grabbed from elsewhere', async () => {
		prismaMock.wantedEvent.findFirst.mockResolvedValue(null);
		expect(await service.reportedNzb('ZP1M', 'a'.repeat(64))).toBe(false);
		expect(prismaMock.wantedEvent.findFirst.mock.calls[0][0].where).toEqual({
			nzb: 'a'.repeat(64),
			shortId: 'ZP1M',
			kind: 'grabbed',
			torrent: false,
			dmmId: null,
		});
		prismaMock.wantedEvent.findFirst.mockResolvedValue({ id: BigInt(1) });
		expect(await service.reportedNzb('ZP1M', 'a'.repeat(64))).toBe(true);
	});

	it('records a held NZB by its sha alone', async () => {
		await service.markNzbHeld('a'.repeat(64));
		expect(prismaMock.wantedNzb.createMany).toHaveBeenCalledWith({
			data: [{ sha: 'a'.repeat(64) }],
			skipDuplicates: true,
		});
	});

	it("answers an item's history only from the sponsor's list, newest first", async () => {
		prismaMock.wantedItem.findFirst.mockResolvedValue(null);
		expect(await service.history('ZP1M', ID)).toBeNull();
		expect(prismaMock.wantedEvent.findMany).not.toHaveBeenCalled();

		prismaMock.wantedItem.findFirst.mockResolvedValue({
			progress: [{ season: 1, have: [1], missing: [2] }],
		});
		prismaMock.wantedEvent.findMany.mockResolvedValue([
			{
				...event(),
				id: BigInt(1),
				shortId: 'ZP1M',
				imdbId: 'tt0115082',
				size: BigInt(5),
				shared: true,
			},
		]);
		const history = await service.history('ZP1M', ID);
		expect(prismaMock.wantedEvent.findMany.mock.calls[0][0]).toMatchObject({
			where: { itemId: ID, shortId: 'ZP1M' },
			orderBy: [{ at: 'desc' }, { id: 'desc' }],
			take: 200,
		});
		expect(history!.seasons).toEqual([{ season: 1, have: [1], missing: [2] }]);
		expect(history!.events[0]).toMatchObject({ kind: 'grabbed', size: 5 });
		expect(history!.events[0]).not.toHaveProperty('key');
		expect(history!.events[0]).not.toHaveProperty('shortId');
	});

	it("prunes a zurg's own events at one age and shared ones at another", async () => {
		prismaMock.wantedEvent.deleteMany.mockResolvedValue({ count: 2 });
		const local = new Date('2026-10-20T00:00:00Z');
		const shared = new Date('2026-05-23T00:00:00Z');
		expect(await service.prune(local, shared)).toBe(4);
		expect(prismaMock.wantedEvent.deleteMany.mock.calls.map(([arg]) => arg.where)).toEqual([
			{ shared: false, createdAt: { lt: local } },
			{ shared: true, createdAt: { lt: shared } },
		]);
	});
});
