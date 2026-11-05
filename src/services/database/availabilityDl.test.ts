import dlTv from '@/test/fixtures/libraryAvailability/dl_tv.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AvailabilityService } from './availability';

const upsert = vi.fn();
const findMany = vi.fn();
const deleteMany = vi.fn();
vi.mock('@prisma/client', () => ({
	PrismaClient: vi.fn().mockImplementation(function () {
		return { availableDl: { upsert, findMany, deleteMany }, $disconnect: vi.fn() };
	}),
}));

describe('AvailabilityService Debrid-Link', () => {
	let service: AvailabilityService;
	beforeEach(() => {
		vi.clearAllMocks();
		service = new AvailabilityService();
	});

	it('stores each file with its season and episode, and the release total', async () => {
		// a real 24-file season pack from the Debrid-Link main account (2026-11-05)
		await service.upsertAvailabilityDl({
			hash: dlTv.hashString.toUpperCase(),
			imdbId: 'tt0108778',
			filename: dlTv.name,
			files: dlTv.files.map((f) => ({ path: f.name, bytes: f.size })),
		});
		const { where, create, update } = upsert.mock.calls[0][0];
		expect(where).toEqual({ hash: dlTv.hashString });
		expect(create.bytes).toBe(BigInt(dlTv.files.reduce((sum, f) => sum + f.size, 0)));
		expect(create.season).toBe(5);
		expect(create.files.create).toHaveLength(24);
		expect(create.files.create[0]).toMatchObject({ file_id: 0, season: 5, episode: 10 });
		// a later sighting replaces the file list rather than adding to it
		expect(update.files.deleteMany).toEqual({});
	});

	it('scopes a check to the IMDb id only when one is given', async () => {
		findMany.mockResolvedValue([
			{ hash: dlTv.hashString, files: [{ file_id: 0, path: 'a.mkv', bytes: BigInt(5) }] },
		]);
		const found = await service.checkAvailabilityDl(
			[dlTv.hashString.toUpperCase()],
			'tt0108778'
		);
		expect(findMany.mock.calls[0][0].where).toEqual({
			imdbId: 'tt0108778',
			hash: { in: [dlTv.hashString] },
		});
		expect(found).toEqual([
			{ hash: dlTv.hashString, files: [{ file_id: 0, path: 'a.mkv', bytes: 5 }] },
		]);
		await service.checkAvailabilityDl([dlTv.hashString]);
		expect(findMany.mock.calls[1][0].where).toEqual({ hash: { in: [dlTv.hashString] } });
	});
});
