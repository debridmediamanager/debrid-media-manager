import handler from '@/pages/api/debrid-uploader/jobs';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { isFreeTorBoxPlan } from '@/utils/torboxPlan';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/torboxPlan', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/utils/torboxPlan')>()),
	isFreeTorBoxPlan: vi.fn(async () => false),
}));
vi.mock('@/services/debridUploaderServers', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/debridUploaderServers')>()),
	orderedServersForNewJob: vi.fn(() => ['http://uploader:3100']),
	resolveJobServer: vi.fn(async () => 'http://uploader:3100'),
}));

const mockRepo = vi.mocked(repository);

const HASH = 'b'.repeat(40);
const GB = 1e9;

const post = async (body: Record<string, unknown>) => {
	const req = createMockRequest({ method: 'POST', body });
	const res = createMockResponse();
	await handler(req as any, res as any);
	return res;
};

const validBody = (over?: Record<string, unknown>) => ({
	hash: HASH,
	imdbId: 'tt0118480',
	rdKey: 'rd-key',
	tbKey: 'tb-key',
	...over,
});

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(isFreeTorBoxPlan).mockResolvedValue(false);
	mockRepo.getDebridTransfer = vi.fn().mockResolvedValue(null);
	mockRepo.recordDebridTransferPending = vi.fn().mockResolvedValue(undefined);
	mockRepo.recordDebridJobServer = vi.fn().mockResolvedValue(undefined);
	mockRepo.recordTransferMeta = vi.fn().mockResolvedValue(undefined);
	mockRepo.checkAvailabilityByHashes = vi.fn().mockResolvedValue([]);
	global.fetch = vi.fn().mockResolvedValue({
		ok: true,
		status: 201,
		json: async () => ({ id: 'job-1' }),
	}) as any;
});

// The uploader is a pure proxy, so every byte is billed on the way back out and
// a job that fails after moving most of a release costs as much as one that
// succeeds. Measured over 30 days to 2026-08-29: 0 of 14 releases above 200 GB
// ever completed, burning 6.05 TB.
describe('POST /api/debrid-uploader/jobs — the size cap', () => {
	it('refuses a release over the cap without calling the uploader', async () => {
		const res = await post(validBody({ sizeBytes: 600.5 * GB }));

		expect(res._getStatusCode()).toBe(413);
		expect(res._getData()).toMatchObject({
			error: 'too large to transfer — 600.5 GB, over the 100 GB limit',
			maxBytes: 100 * GB,
		});
		expect(global.fetch).not.toHaveBeenCalled();
		expect(mockRepo.recordDebridTransferPending).not.toHaveBeenCalled();
	});

	it('admits a release at the cap', async () => {
		const res = await post(validBody({ sizeBytes: 100 * GB }));

		expect(res._getStatusCode()).toBe(201);
		expect(global.fetch).toHaveBeenCalled();
	});

	// The service learns the real size 4-12s in and refuses there, so guessing
	// here would only deny transfers that are fine.
	it('lets a release with no known size through to the uploader', async () => {
		const res = await post(validBody());

		expect(res._getStatusCode()).toBe(201);
		expect(global.fetch).toHaveBeenCalled();
	});

	// The cap stops a *new* transfer. One that already completed before the cap
	// existed is RD-cached under its rewritten hash, and handing that to the
	// caller is a single instant addMagnet that spends no uploader bandwidth at
	// all — refusing it would deny content for free.
	it('still serves an oversize release that was already transferred', async () => {
		mockRepo.getDebridTransfer = vi.fn().mockResolvedValue({
			status: 'completed',
			jobId: 'old-job',
			rewrittenHash: 'c'.repeat(40),
		});
		mockRepo.checkAvailabilityByHashes = vi.fn().mockResolvedValue([{ hash: 'c'.repeat(40) }]);
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 201,
			json: async () => ({ id: 'rd-torrent' }),
		}) as any;

		const res = await post(validBody({ sizeBytes: 600.5 * GB }));

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toMatchObject({ duplicate: 'completed', addedToRd: true });
	});
});

// TorBox is the only cache source, and a free account's `createtorrent` answers
// 403 PLAN_RESTRICTED_FEATURE, so a job submitted with one could only fail.
// Nineteen did between 2026-08-08 and 2026-09-23.
describe('POST /api/debrid-uploader/jobs — a free TorBox account', () => {
	const withTorBoxPlan = (plan: number) =>
		vi.mocked(isFreeTorBoxPlan).mockResolvedValue(plan === 0);
	const uploaderCalls = () => vi.mocked(global.fetch).mock.calls;

	it('is refused before anything is queued', async () => {
		withTorBoxPlan(0);
		const res = await post(validBody());

		expect(res._getStatusCode()).toBe(403);
		expect(res._getData()).toMatchObject({ error: expect.stringMatching(/free plan/) });
		expect(isFreeTorBoxPlan).toHaveBeenCalledWith('tb-key');
		expect(uploaderCalls()).toHaveLength(0);
		expect(mockRepo.recordDebridTransferPending).not.toHaveBeenCalled();
	});

	it('does not stop a paid account', async () => {
		withTorBoxPlan(2);
		const res = await post(validBody());

		expect(res._getStatusCode()).toBe(201);
		expect(uploaderCalls()).toHaveLength(1);
	});

	// Serving a completed duplicate is one RD addMagnet and never touches TorBox.
	it('still serves an already-completed transfer', async () => {
		withTorBoxPlan(0);
		mockRepo.getDebridTransfer = vi.fn().mockResolvedValue({
			status: 'completed',
			jobId: 'old-job',
			rewrittenHash: 'c'.repeat(40),
		});
		mockRepo.checkAvailabilityByHashes = vi.fn().mockResolvedValue([{ hash: 'c'.repeat(40) }]);

		const res = await post(validBody());

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toMatchObject({ duplicate: 'completed' });
	});
});
