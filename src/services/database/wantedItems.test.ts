import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MAX_WANTED_ITEMS, WantedItemsService } from './wantedItems';

const prismaMock = vi.hoisted(() => ({
	wantedItem: {
		findMany: vi.fn(),
		findUnique: vi.fn(),
		findFirst: vi.fn(),
		count: vi.fn(),
		createMany: vi.fn(),
		upsert: vi.fn(),
		deleteMany: vi.fn(),
		updateMany: vi.fn(),
	},
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

const ROW = {
	id: '0b7c2f8e-1d1f-4a55-9c3a-6c9d8e7f1a2b',
	shortId: 'ZP1M',
	imdbId: 'tt0133093',
	kind: 'movie',
	title: 'The Matrix',
	seasons: null,
	createdAt: new Date(),
	fulfilledAt: null,
	fulfilled: null,
	lastPolledAt: null,
};

describe('WantedItemsService', () => {
	let service: WantedItemsService;
	beforeEach(() => {
		service = new WantedItemsService();
		for (const fn of Object.values(prismaMock.wantedItem)) (fn as Mock).mockReset();
	});

	it('refuses a new title once the list is full', async () => {
		prismaMock.wantedItem.findUnique.mockResolvedValue(null);
		prismaMock.wantedItem.count.mockResolvedValue(MAX_WANTED_ITEMS);
		await expect(
			service.want('ZP1M', { imdbId: 'tt0133093', kind: 'movie', title: 'x', seasons: null })
		).resolves.toBeNull();
		expect(prismaMock.wantedItem.upsert).not.toHaveBeenCalled();
	});

	// Wanting a film again after zurg fetched it means fetch it again.
	it('clears the acknowledgement when a title is wanted again', async () => {
		prismaMock.wantedItem.findUnique.mockResolvedValue({ id: ROW.id });
		prismaMock.wantedItem.upsert.mockResolvedValue(ROW);
		await service.want('ZP1M', {
			imdbId: 'tt0133093',
			kind: 'movie',
			title: 'x',
			seasons: null,
		});
		expect(prismaMock.wantedItem.count).not.toHaveBeenCalled();
		expect(prismaMock.wantedItem.upsert.mock.calls[0][0].update.fulfilledAt).toBeNull();
		expect(prismaMock.wantedItem.upsert.mock.calls[0][0].update.fulfilled).toBe(Prisma.DbNull);
	});

	// An import from Radarr or Sonarr leaves titles already wanted as they are.
	it('imports only titles not wanted yet, until the list is full', async () => {
		prismaMock.wantedItem.findMany.mockResolvedValue([
			...Array.from({ length: MAX_WANTED_ITEMS - 2 }, (_, i) => ({
				imdbId: `tt${9000000 + i}`,
			})),
			{ imdbId: 'tt0133093' },
		]);
		const film = (imdbId: string) => ({
			imdbId,
			kind: 'movie' as const,
			title: imdbId,
			seasons: null,
		});
		await expect(
			service.wantMany('ZP1M', [film('tt0133093'), film('tt0234215'), film('tt0242653')])
		).resolves.toEqual({ added: 1, alreadyWanted: 1, overCap: 1 });
		expect(prismaMock.wantedItem.createMany.mock.calls[0][0].data).toEqual([
			{
				shortId: 'ZP1M',
				imdbId: 'tt0234215',
				kind: 'movie',
				title: 'tt0234215',
				seasons: Prisma.DbNull,
			},
		]);
	});

	const TOOK = {
		release: 'The.Matrix.1999.1080p.BluRay.x264-GRP',
		grab: 'c'.repeat(40),
		torrent: true,
		resolution: '1080p',
	};

	it('dates the first acknowledgement and stores what zurg took', async () => {
		prismaMock.wantedItem.findFirst.mockResolvedValue({ fulfilledAt: null });
		await expect(
			service.markFulfilled('ZP1M', ROW.id, { ...TOOK, upgradeTo: '2160p' })
		).resolves.toBe(true);
		expect(prismaMock.wantedItem.updateMany).toHaveBeenCalledWith({
			where: { shortId: 'ZP1M', id: ROW.id },
			data: { fulfilled: { ...TOOK, upgradeTo: '2160p' }, fulfilledAt: expect.any(Date) },
		});
	});

	// Each acknowledgement replaces what zurg holds, upgrade wish included.
	it('keeps the first date and overwrites what zurg took when it repeats', async () => {
		const first = new Date('2026-10-01');
		prismaMock.wantedItem.findFirst.mockResolvedValue({ fulfilledAt: first });
		await expect(service.markFulfilled('ZP1M', ROW.id, TOOK)).resolves.toBe(true);
		expect(prismaMock.wantedItem.updateMany).toHaveBeenCalledWith({
			where: { shortId: 'ZP1M', id: ROW.id },
			data: { fulfilled: TOOK, fulfilledAt: first },
		});
	});

	it("does not acknowledge another sponsor's item", async () => {
		prismaMock.wantedItem.findFirst.mockResolvedValue(null);
		await expect(service.markFulfilled('OTHER', ROW.id, TOOK)).resolves.toBe(false);
		expect(prismaMock.wantedItem.updateMany).not.toHaveBeenCalled();
		expect(prismaMock.wantedItem.findFirst).toHaveBeenCalledWith({
			where: { shortId: 'OTHER', id: ROW.id },
			select: { fulfilledAt: true, fulfilled: true },
		});
	});

	// A zurg keeping a copy at several resolutions acknowledges each on its own.
	it('stores a band acknowledgement beside the bands already held', async () => {
		const uhd = { ...TOOK, grab: 'd'.repeat(40), resolution: '2160p' };
		prismaMock.wantedItem.findFirst.mockResolvedValue({ fulfilledAt: null, fulfilled: null });
		await service.markFulfilled('ZP1M', ROW.id, { ...TOOK, upgradeTo: '2160p' }, '2160p');
		expect(prismaMock.wantedItem.updateMany).toHaveBeenLastCalledWith({
			where: { shortId: 'ZP1M', id: ROW.id },
			data: {
				fulfilled: { ...TOOK, bands: { '2160p': { ...TOOK, upgradeTo: '2160p' } } },
				fulfilledAt: expect.any(Date),
			},
		});

		const first = new Date('2026-10-01');
		const before = { ...TOOK, bands: { '2160p': { ...TOOK, upgradeTo: '2160p' } } };
		prismaMock.wantedItem.findFirst.mockResolvedValue({
			fulfilledAt: first,
			fulfilled: before,
		});
		await service.markFulfilled('ZP1M', ROW.id, TOOK, '1080p');
		await service.markFulfilled('ZP1M', ROW.id, uhd, '2160p');
		expect(prismaMock.wantedItem.updateMany).toHaveBeenNthCalledWith(2, {
			where: { shortId: 'ZP1M', id: ROW.id },
			data: {
				fulfilled: { ...before, bands: { ...before.bands, '1080p': TOOK } },
				fulfilledAt: first,
			},
		});
		expect(prismaMock.wantedItem.updateMany).toHaveBeenLastCalledWith({
			where: { shortId: 'ZP1M', id: ROW.id },
			data: { fulfilled: { ...TOOK, bands: { '2160p': uhd } }, fulfilledAt: first },
		});
	});

	// An older zurg on the same key acknowledges without a band; the bands stay.
	it('keeps the bands when an acknowledgement names none', async () => {
		const bands = { '1080p': TOOK };
		prismaMock.wantedItem.findFirst.mockResolvedValue({
			fulfilledAt: new Date('2026-10-01'),
			fulfilled: { ...TOOK, bands },
		});
		const later = { ...TOOK, grab: 'e'.repeat(40) };
		await service.markFulfilled('ZP1M', ROW.id, later);
		expect(prismaMock.wantedItem.updateMany).toHaveBeenCalledWith({
			where: { shortId: 'ZP1M', id: ROW.id },
			data: { fulfilled: { ...later, bands }, fulfilledAt: expect.any(Date) },
		});
	});

	it('reads nothing for an empty sponsor', async () => {
		await expect(service.list('')).resolves.toEqual([]);
		expect(prismaMock.wantedItem.findMany).not.toHaveBeenCalled();
	});
});
