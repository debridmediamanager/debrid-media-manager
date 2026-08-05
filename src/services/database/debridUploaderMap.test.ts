import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebridUploaderMapService } from './debridUploaderMap';

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

const HASH = 'A'.repeat(40); // uppercase to exercise normalization
const REWRITTEN = 'b'.repeat(40);

describe('DebridUploaderMapService', () => {
	let service: DebridUploaderMapService;
	let prisma: any;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new DebridUploaderMapService();
		prisma = (service as any).prisma;
	});

	it('keys reads by a lowercased tbrd: prefix', async () => {
		prisma.cache.findUnique.mockResolvedValue({
			key: `tbrd:${'a'.repeat(40)}`,
			value: { originalHash: 'a'.repeat(40), jobId: 'j', imdbId: 'tt1', status: 'pending' },
		});
		const rec = await service.getTransfer(HASH);
		expect(prisma.cache.findUnique).toHaveBeenCalledWith({
			where: { key: `tbrd:${'a'.repeat(40)}` },
		});
		expect(rec?.jobId).toBe('j');
	});

	it('returns null when no mapping exists', async () => {
		prisma.cache.findUnique.mockResolvedValue(null);
		expect(await service.getTransfer(HASH)).toBeNull();
	});

	it('batch-reads by keying every hash', async () => {
		prisma.cache.findMany.mockResolvedValue([
			{ value: { originalHash: 'a'.repeat(40), status: 'completed' } },
		]);
		const recs = await service.getTransfers([HASH, 'c'.repeat(40)]);
		expect(prisma.cache.findMany).toHaveBeenCalledWith({
			where: { key: { in: [`tbrd:${'a'.repeat(40)}`, `tbrd:${'c'.repeat(40)}`] } },
		});
		expect(recs).toHaveLength(1);
	});

	it('short-circuits an empty batch without querying', async () => {
		expect(await service.getTransfers([])).toEqual([]);
		expect(prisma.cache.findMany).not.toHaveBeenCalled();
	});

	it('records a pending mapping, lowercasing the hash', async () => {
		prisma.cache.findUnique.mockResolvedValue(null);
		await service.recordPending(HASH, 'job-1', 'tt42');
		const call = prisma.cache.upsert.mock.calls[0][0];
		expect(call.where.key).toBe(`tbrd:${'a'.repeat(40)}`);
		expect(call.create.value.status).toBe('pending');
		expect(call.create.value.originalHash).toBe('a'.repeat(40));
		expect(call.create.value.jobId).toBe('job-1');
	});

	it('never downgrades a completed mapping back to pending', async () => {
		prisma.cache.findUnique.mockResolvedValue({
			value: { originalHash: 'a'.repeat(40), status: 'completed', rewrittenHash: REWRITTEN },
		});
		await service.recordPending(HASH, 'job-2', 'tt42');
		expect(prisma.cache.upsert).not.toHaveBeenCalled();
	});

	it('records a completed mapping with the rewritten hash', async () => {
		await service.recordCompleted(HASH, 'job-3', 'tt42', REWRITTEN.toUpperCase());
		const call = prisma.cache.upsert.mock.calls[0][0];
		expect(call.create.value.status).toBe('completed');
		expect(call.create.value.rewrittenHash).toBe(REWRITTEN);
		expect(call.create.value.originalHash).toBe('a'.repeat(40));
	});

	it('swallows a delete miss', async () => {
		prisma.cache.delete.mockRejectedValue(new Error('not found'));
		await expect(service.removeTransfer(HASH)).resolves.toBeUndefined();
	});
});
