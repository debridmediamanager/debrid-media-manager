import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Nzb2rdMapService } from './nzb2rdMap';

vi.mock('@prisma/client', () => ({
	PrismaClient: vi.fn(() => ({
		cache: {
			upsert: vi.fn(),
			findUnique: vi.fn(),
			findMany: vi.fn(),
			delete: vi.fn(),
		},
		$disconnect: vi.fn(),
	})),
}));

const RELEASE = 'ABC123def'; // mixed case to exercise normalization
const HASH = 'F'.repeat(40);

describe('Nzb2rdMapService', () => {
	let service: Nzb2rdMapService;
	let prisma: any;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new Nzb2rdMapService();
		prisma = (service as any).prisma;
	});

	it('keys reads by a lowercased nzbrd: prefix', async () => {
		prisma.cache.findUnique.mockResolvedValue({
			key: 'nzbrd:abc123def',
			value: { releaseId: 'abc123def', jobId: 'j', imdbId: 'tt1418646', status: 'pending' },
		});
		const rec = await service.getTransfer(RELEASE);
		expect(prisma.cache.findUnique).toHaveBeenCalledWith({ where: { key: 'nzbrd:abc123def' } });
		expect(rec?.jobId).toBe('j');
	});

	it('returns null when no mapping exists', async () => {
		prisma.cache.findUnique.mockResolvedValue(null);
		expect(await service.getTransfer(RELEASE)).toBeNull();
	});

	it('batch-reads with prefixed keys and no query for an empty list', async () => {
		prisma.cache.findMany.mockResolvedValue([{ key: 'nzbrd:a', value: { releaseId: 'a' } }]);
		expect(await service.getTransfers(['A', 'b'])).toHaveLength(1);
		expect(prisma.cache.findMany).toHaveBeenCalledWith({
			where: { key: { in: ['nzbrd:a', 'nzbrd:b'] } },
		});

		prisma.cache.findMany.mockClear();
		expect(await service.getTransfers([])).toEqual([]);
		expect(prisma.cache.findMany).not.toHaveBeenCalled();
	});

	it('records a pending transfer with a lowercased release id', async () => {
		prisma.cache.findUnique.mockResolvedValue(null);
		await service.recordPending(RELEASE, 'job-1', 'tt1418646', 'Some.Release');

		const call = prisma.cache.upsert.mock.calls[0][0];
		expect(call.where).toEqual({ key: 'nzbrd:abc123def' });
		expect(call.create.value).toMatchObject({
			releaseId: 'abc123def',
			jobId: 'job-1',
			imdbId: 'tt1418646',
			status: 'pending',
			title: 'Some.Release',
		});
	});

	it('never downgrades a completed mapping back to pending', async () => {
		prisma.cache.findUnique.mockResolvedValue({
			key: 'nzbrd:abc123def',
			value: { releaseId: 'abc123def', jobId: 'j', imdbId: 'tt1', status: 'completed' },
		});
		await service.recordPending(RELEASE, 'job-2', 'tt1418646');
		expect(prisma.cache.upsert).not.toHaveBeenCalled();
	});

	it('records completion with the built info hash, lowercased', async () => {
		await service.recordCompleted(RELEASE, 'job-1', 'tt1418646', HASH, 'Some.Release');

		const call = prisma.cache.upsert.mock.calls[0][0];
		expect(call.create.value).toMatchObject({
			releaseId: 'abc123def',
			status: 'completed',
			infoHash: 'f'.repeat(40),
		});
	});

	it('swallows a delete for a mapping that is not there', async () => {
		prisma.cache.delete.mockRejectedValue(new Error('not found'));
		await expect(service.removeTransfer(RELEASE)).resolves.toBeUndefined();
	});
});
