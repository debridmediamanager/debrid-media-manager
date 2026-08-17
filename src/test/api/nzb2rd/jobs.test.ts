import handler from '@/pages/api/nzb2rd/jobs';
import { addHashToRdAccount, fetchNzb, submitNzb } from '@/services/nzb2rd';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/nzb2rd', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/nzb2rd')>();
	return {
		...actual,
		fetchNzb: vi.fn(),
		submitNzb: vi.fn(),
		addHashToRdAccount: vi.fn(),
	};
});

const mockRepo = vi.mocked(repository);
const mockFetchNzb = vi.mocked(fetchNzb);
const mockSubmit = vi.mocked(submitNzb);
const mockAddToRd = vi.mocked(addHashToRdAccount);

const HASH = 'a'.repeat(40);
const body = (over: Record<string, unknown> = {}) => ({
	id: 'release-1',
	title: 'Some.Release.1080p',
	imdbId: 'tt1418646',
	rdKey: 'rd-key-b',
	...over,
});

const run = async (over: Record<string, unknown> = {}) => {
	const req = createMockRequest({ method: 'POST', body: body(over) });
	const res = createMockResponse();
	await handler(req as any, res as any);
	return res;
};

beforeEach(() => {
	vi.clearAllMocks();
	mockRepo.getNzb2rdTransfer = vi.fn().mockResolvedValue(null);
	mockRepo.recordNzb2rdTransferPending = vi.fn().mockResolvedValue(undefined);
	mockRepo.addNzb2rdWaiter = vi.fn().mockResolvedValue(undefined);
	mockRepo.checkAvailabilityByHashes = vi.fn().mockResolvedValue([{ hash: HASH }]);
	mockFetchNzb.mockResolvedValue('<nzb></nzb>');
	mockSubmit.mockResolvedValue({ status: 201, data: { id: 'job-1', status: 'pending' } });
	global.fetch = vi.fn().mockResolvedValue({
		status: 200,
		json: async () => ({ status: 'fetching' }),
	}) as any;
});

describe('POST /api/nzb2rd/jobs — user B asks for a release user A is already fetching', () => {
	beforeEach(() => {
		mockRepo.getNzb2rdTransfer = vi.fn().mockResolvedValue({
			releaseId: 'release-1',
			jobId: 'job-A',
			imdbId: 'tt1418646',
			status: 'pending',
		});
	});

	it('queues B against A/s job instead of starting a second Usenet fetch', async () => {
		const res = await run();

		expect(mockRepo.addNzb2rdWaiter).toHaveBeenCalledWith(
			'release-1',
			'rd-key-b',
			'tt1418646',
			null
		);
		expect(res.json).toHaveBeenCalledWith({
			duplicate: 'in_progress',
			infoHash: null,
			jobId: 'job-A',
			queued: true,
		});
		// the expensive half never runs
		expect(mockFetchNzb).not.toHaveBeenCalled();
		expect(mockSubmit).not.toHaveBeenCalled();
	});

	// The waiter list is drained when A's job completes, days later, by which
	// time B's access token has expired — so the credentials have to be parked
	// with them or the delivery fails silently.
	it('parks B/s refreshable credentials alongside their token', async () => {
		const oauth = { clientId: 'CID', clientSecret: 'CSEC', refreshToken: 'CREF' };
		await run({ oauth });

		expect(mockRepo.addNzb2rdWaiter).toHaveBeenCalledWith(
			'release-1',
			'rd-key-b',
			'tt1418646',
			oauth
		);
	});

	it('does not charge B an RD add while the job is still running', async () => {
		await run();
		expect(mockAddToRd).not.toHaveBeenCalled();
	});
});

describe('POST /api/nzb2rd/jobs — the release is already finished', () => {
	beforeEach(() => {
		mockRepo.getNzb2rdTransfer = vi.fn().mockResolvedValue({
			releaseId: 'release-1',
			jobId: 'job-A',
			imdbId: 'tt1418646',
			status: 'completed',
			infoHash: HASH,
		});
	});

	it('adds the cached torrent straight to the caller/s account', async () => {
		mockAddToRd.mockResolvedValue('rd-torrent-1');

		const res = await run();

		expect(mockAddToRd).toHaveBeenCalledWith('rd-key-b', HASH);
		expect(res.json).toHaveBeenCalledWith({
			duplicate: 'completed',
			infoHash: HASH,
			jobId: 'job-A',
			added: true,
		});
		expect(mockSubmit).not.toHaveBeenCalled();
	});

	it('reports added:false rather than failing when the RD add errors', async () => {
		mockAddToRd.mockRejectedValue(new Error('RD 503'));

		const res = await run();

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({ duplicate: 'completed', added: false })
		);
	});

	it('re-fetches when the cached torrent is no longer in RD', async () => {
		mockRepo.checkAvailabilityByHashes = vi.fn().mockResolvedValue([]);

		await run();

		expect(mockSubmit).toHaveBeenCalledTimes(1);
		expect(mockAddToRd).not.toHaveBeenCalled();
	});
});

describe('POST /api/nzb2rd/jobs — nothing recorded yet', () => {
	it('submits a new job and records it as pending', async () => {
		const res = await run();

		expect(mockSubmit).toHaveBeenCalledTimes(1);
		expect(mockRepo.recordNzb2rdTransferPending).toHaveBeenCalledWith(
			'release-1',
			'job-1',
			'tt1418646',
			'Some.Release.1080p'
		);
		expect(res.status).toHaveBeenCalledWith(201);
		expect(mockRepo.addNzb2rdWaiter).not.toHaveBeenCalled();
	});

	// Without these nzb2rd only has the 24h access token, and its queue is days
	// deep — the job is then guaranteed to reach the RD hand-off with a dead
	// credential and fail as `401 bad_token`.
	it('forwards the refreshable credentials to nzb2rd', async () => {
		const oauth = { clientId: 'CID', clientSecret: 'CSEC', refreshToken: 'CREF' };
		await run({ oauth });

		expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ oauth }));
	});

	// A partial triple cannot mint anything, so it must not be stored downstream.
	it('forwards null rather than an unusable partial triple', async () => {
		await run({ oauth: { clientId: 'CID', refreshToken: 'CREF' } });

		expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ oauth: null }));
	});

	it('rejects a missing RD key before spending anything', async () => {
		const res = await run({ rdKey: '' });

		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockFetchNzb).not.toHaveBeenCalled();
	});
});
