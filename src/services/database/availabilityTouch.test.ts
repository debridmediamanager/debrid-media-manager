import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AvailabilityService } from './availability';

const prismaMock = vi.hoisted(() => ({
	availableFile: { findMany: vi.fn() },
	available: { updateMany: vi.fn() },
	availableAdFile: { findFirst: vi.fn() },
	availableAd: { updateMany: vi.fn() },
	availableDl: { updateMany: vi.fn() },
}));
vi.mock('@prisma/client', () => ({
	PrismaClient: vi.fn().mockImplementation(function () {
		return { ...prismaMock, $disconnect: vi.fn() };
	}),
}));

// Cast offers a recorded release only while its row is fresh, and nothing refreshed one: a
// release viewers kept playing aged out of Cast as surely as a dead one. A play that worked
// is proof it still serves; refreshing at most daily keeps plays from becoming writes.
describe('AvailabilityService refresh on a play that worked', () => {
	let service: AvailabilityService;
	const HASH = 'a'.repeat(40);
	const dayAgo = (at: Date) => Date.now() - at.getTime();

	beforeEach(() => {
		vi.clearAllMocks();
		service = new AvailabilityService();
	});

	it('refreshes the RD record whose file carries the unrestricted link', async () => {
		prismaMock.availableFile.findMany.mockResolvedValue([{ hash: HASH }, { hash: HASH }]);
		await service.touchAvailabilityByLinkPrefix('https://real-debrid.com/d/ABCDEFGHIJKLM');

		expect(prismaMock.availableFile.findMany.mock.calls[0][0].where).toEqual({
			link: { startsWith: 'https://real-debrid.com/d/ABCDEFGHIJKLM' },
		});
		const { where, data } = prismaMock.available.updateMany.mock.calls[0][0];
		expect(where.hash).toEqual({ in: [HASH] });
		expect(where.status).toBe('downloaded');
		expect(dayAgo(where.updatedAt.lt)).toBeGreaterThanOrEqual(24 * 3600 * 1000 - 1000);
		expect(data.updatedAt).toBeInstanceOf(Date);
	});

	it('writes nothing for an RD link no record carries', async () => {
		prismaMock.availableFile.findMany.mockResolvedValue([]);
		await service.touchAvailabilityByLinkPrefix('https://real-debrid.com/d/ZZZZZZZZZZZZZ');
		expect(prismaMock.available.updateMany).not.toHaveBeenCalled();
	});

	it('refreshes the AllDebrid record whose file is the unlocked link', async () => {
		prismaMock.availableAdFile.findFirst.mockResolvedValue({ hash: HASH });
		await service.touchAvailabilityAdByLink('https://alldebrid.com/f/token');
		const { where } = prismaMock.availableAd.updateMany.mock.calls[0][0];
		expect(where).toMatchObject({ hash: HASH, status: 'Ready' });
		expect(where.updatedAt.lt).toBeInstanceOf(Date);
	});

	it('refreshes a Debrid-Link record by its hash', async () => {
		await service.touchAvailabilityDl(HASH.toUpperCase());
		const { where } = prismaMock.availableDl.updateMany.mock.calls[0][0];
		expect(where).toMatchObject({ hash: HASH });
		expect(where.updatedAt.lt).toBeInstanceOf(Date);
	});
});
