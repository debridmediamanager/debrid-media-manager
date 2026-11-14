import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WantedListsService } from './wantedLists';

const prismaMock = vi.hoisted(() => ({
	wantedList: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

const URL = 'https://simkl.com/8199460/list/216324';
const ROW = {
	id: 'list-1',
	shortId: 'ZP1M',
	url: URL,
	name: 'Simkl list 216324',
	seen: [],
	added: 0,
	createdAt: new Date('2026-11-14T10:00:00Z'),
	syncedAt: null,
	error: null,
	simklSession: 'a'.repeat(43),
};

describe('WantedListsService.follow', () => {
	let service: WantedListsService;
	beforeEach(() => {
		vi.clearAllMocks();
		service = new WantedListsService();
		prismaMock.wantedList.update.mockImplementation(async ({ data }) => ({ ...ROW, ...data }));
		prismaMock.wantedList.create.mockImplementation(async ({ data }) => ({ ...ROW, ...data }));
	});

	it('keeps the Simkl sign-in of a new Simkl list', async () => {
		prismaMock.wantedList.findUnique.mockResolvedValue(null);
		const { row, created } = await service.follow('ZP1M', URL, ROW.name, 'b'.repeat(43));
		expect(created).toBe(true);
		expect(prismaMock.wantedList.create).toHaveBeenCalledWith({
			data: {
				shortId: 'ZP1M',
				url: URL,
				name: ROW.name,
				seen: [],
				simklSession: 'b'.repeat(43),
			},
		});
		expect(row.simklSession).toBe('b'.repeat(43));
	});

	it('moves a followed Simkl list to a fresh sign-in, which mends one whose sign-in ended', async () => {
		prismaMock.wantedList.findUnique.mockResolvedValue(ROW);
		const { row, created } = await service.follow('ZP1M', URL, ROW.name, 'b'.repeat(43));
		expect(created).toBe(false);
		expect(prismaMock.wantedList.update).toHaveBeenCalledWith({
			where: { id: 'list-1' },
			data: { simklSession: 'b'.repeat(43) },
		});
		expect(row.simklSession).toBe('b'.repeat(43));
	});

	it('leaves a followed list alone when there is no new sign-in to move it to', async () => {
		prismaMock.wantedList.findUnique.mockResolvedValue(ROW);
		const { row } = await service.follow('ZP1M', URL, ROW.name, ROW.simklSession);
		await service.follow('ZP1M', URL, ROW.name);
		expect(prismaMock.wantedList.update).not.toHaveBeenCalled();
		expect(row.simklSession).toBe(ROW.simklSession);
	});
});
