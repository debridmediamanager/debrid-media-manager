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
		// Every delete in this service is fire-and-forget with a .catch, so the
		// mock has to hand back a promise or the call throws before the assertion.
		prisma.cache.delete.mockResolvedValue(undefined);
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

	describe('recordFailed', () => {
		it('writes a failed marker carrying the reason, and drops the waiters', async () => {
			prisma.cache.findUnique.mockResolvedValue(null);

			await service.recordFailed(RELEASE, 'job-9', 'tt1418646', 'RD refused the credentials');

			expect(prisma.cache.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { key: 'nzbrd:abc123def' },
					create: expect.objectContaining({
						value: expect.objectContaining({
							releaseId: 'abc123def',
							jobId: 'job-9',
							imdbId: 'tt1418646',
							status: 'failed',
							error: 'RD refused the credentials',
						}),
					}),
				})
			);
			// The parked accounts queued behind a job that will never deliver, and
			// their stored Real-Debrid credentials must not outlive it.
			expect(prisma.cache.delete).toHaveBeenCalledWith({
				where: { key: 'nzbwait:abc123def' },
			});
		});

		// The content is in Real-Debrid regardless of what a later job for the same
		// release did, so a completed marker must never be demoted to failed — that
		// would turn a working "Add to RD" into a Retry that fetches it all again.
		it('never demotes a completed marker', async () => {
			prisma.cache.findUnique.mockResolvedValue({
				key: 'nzbrd:abc123def',
				value: { releaseId: 'abc123def', jobId: 'j', status: 'completed', infoHash: HASH },
			});

			await service.recordFailed(RELEASE, 'job-9', 'tt1418646', 'too late');

			expect(prisma.cache.upsert).not.toHaveBeenCalled();
		});

		// The poll route knows the job but not the title it was started from; the
		// marker already holds both, so a failure must not blank them.
		it('keeps the imdb id and title the marker already has', async () => {
			prisma.cache.findUnique.mockResolvedValue({
				key: 'nzbrd:abc123def',
				value: {
					releaseId: 'abc123def',
					jobId: 'j',
					imdbId: 'tt1418646',
					title: 'Some.Release.2160p',
					status: 'pending',
				},
			});

			await service.recordFailed(RELEASE, 'job-9', '');

			expect(prisma.cache.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					create: expect.objectContaining({
						value: expect.objectContaining({
							imdbId: 'tt1418646',
							title: 'Some.Release.2160p',
						}),
					}),
				})
			);
		});
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

describe('Nzb2rdMapService waiters', () => {
	let service: Nzb2rdMapService;
	let prisma: any;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new Nzb2rdMapService();
		prisma = (service as any).prisma;
	});

	const withWaiters = (waiters: unknown[]) => ({
		key: 'nzbwait:abc123def',
		value: { waiters },
	});

	it('queues a waiter under its own key, apart from the transfer record', async () => {
		prisma.cache.findUnique.mockResolvedValue(null);

		await service.addWaiter(RELEASE, 'rd-key-b', 'tt1418646');

		const call = prisma.cache.upsert.mock.calls[0][0];
		expect(call.where).toEqual({ key: 'nzbwait:abc123def' });
		expect(call.create.value.waiters).toHaveLength(1);
		expect(call.create.value.waiters[0]).toMatchObject({
			rdKey: 'rd-key-b',
			imdbId: 'tt1418646',
		});
	});

	it('appends a second account without dropping the first', async () => {
		prisma.cache.findUnique.mockResolvedValue(
			withWaiters([{ rdKey: 'rd-key-b', imdbId: 'tt1', queuedAt: 1 }])
		);

		await service.addWaiter(RELEASE, 'rd-key-c', 'tt1418646');

		const value = prisma.cache.upsert.mock.calls[0][0].create.value;
		expect(value.waiters.map((w: any) => w.rdKey)).toEqual(['rd-key-b', 'rd-key-c']);
	});

	it('does not queue the same account twice', async () => {
		prisma.cache.findUnique.mockResolvedValue(
			withWaiters([{ rdKey: 'rd-key-b', imdbId: 'tt1', queuedAt: 1 }])
		);

		await service.addWaiter(RELEASE, 'rd-key-b', 'tt1418646');

		expect(prisma.cache.upsert).not.toHaveBeenCalled();
	});

	it('caps the list so a popular release cannot grow one row without limit', async () => {
		const many = Array.from({ length: Nzb2rdMapService.MAX_WAITERS }, (_, i) => ({
			rdKey: `k${i}`,
			imdbId: 'tt1',
			queuedAt: i,
		}));
		prisma.cache.findUnique.mockResolvedValue(withWaiters(many));

		await service.addWaiter(RELEASE, 'newcomer', 'tt1418646');

		const value = prisma.cache.upsert.mock.calls[0][0].create.value;
		expect(value.waiters).toHaveLength(Nzb2rdMapService.MAX_WAITERS);
		expect(value.waiters.at(-1).rdKey).toBe('newcomer');
		expect(value.waiters[0].rdKey).toBe('k1'); // oldest dropped
	});

	// Delivery must be once-only: a second poll landing at the same moment would
	// otherwise add the same torrent to the same account twice.
	it('takeWaiters returns the list and clears it', async () => {
		prisma.cache.findUnique.mockResolvedValue(
			withWaiters([{ rdKey: 'rd-key-b', imdbId: 'tt1', queuedAt: 1 }])
		);

		const taken = await service.takeWaiters(RELEASE);

		expect(taken).toHaveLength(1);
		expect(prisma.cache.delete).toHaveBeenCalledWith({ where: { key: 'nzbwait:abc123def' } });
	});

	it('takeWaiters does not delete when there was nothing queued', async () => {
		prisma.cache.findUnique.mockResolvedValue(null);

		expect(await service.takeWaiters(RELEASE)).toEqual([]);
		expect(prisma.cache.delete).not.toHaveBeenCalled();
	});

	it('cancelling a transfer also drops anyone waiting on it', async () => {
		prisma.cache.findUnique.mockResolvedValue(null);
		await service.removeTransfer(RELEASE);

		const keys = prisma.cache.delete.mock.calls.map((c: any[]) => c[0].where.key);
		expect(keys).toEqual(['nzbrd:abc123def', 'nzbwait:abc123def']);
	});
});
