import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MAX_WANTED_ITEMS, WantedItemsService } from './wantedItems';

const prismaMock = vi.hoisted(() => ({
	wantedItem: {
		findMany: vi.fn(),
		findUnique: vi.fn(),
		findFirst: vi.fn(),
		count: vi.fn(),
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
	});

	it('keeps the first acknowledgement date when zurg repeats it', async () => {
		prismaMock.wantedItem.findFirst.mockResolvedValue({ fulfilledAt: new Date('2026-10-01') });
		await expect(service.markFulfilled('ZP1M', ROW.id)).resolves.toBe(true);
		expect(prismaMock.wantedItem.updateMany).not.toHaveBeenCalled();
	});

	it("does not acknowledge another sponsor's item", async () => {
		prismaMock.wantedItem.findFirst.mockResolvedValue(null);
		await expect(service.markFulfilled('OTHER', ROW.id)).resolves.toBe(false);
		expect(prismaMock.wantedItem.findFirst).toHaveBeenCalledWith({
			where: { shortId: 'OTHER', id: ROW.id },
			select: { fulfilledAt: true },
		});
	});

	it('reads nothing for an empty sponsor', async () => {
		await expect(service.list('')).resolves.toEqual([]);
		expect(prismaMock.wantedItem.findMany).not.toHaveBeenCalled();
	});
});
