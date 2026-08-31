import handler from '@/pages/api/nzb2rd/registered';
import { repository } from '@/services/repository';
import { registerCompletedNzb2rdJob } from '@/services/transferRegistration';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/transferRegistration', () => ({
	registerCompletedNzb2rdJob: vi.fn().mockResolvedValue(true),
}));

const mockRepo = vi.mocked(repository);
const mockRegister = vi.mocked(registerCompletedNzb2rdJob);

const HASH = 'c'.repeat(40);

const pendingRecord = {
	releaseId: 'release-1',
	jobId: 'job-1',
	imdbId: 'tt1308738',
	status: 'pending' as const,
	updatedAt: 1,
};

const run = async (ids: string[] = ['release-1']) => {
	const req = createMockRequest({ method: 'POST', body: { ids } });
	const res = createMockResponse();
	await handler(req as any, res as any);
	return res;
};

/** What nzb2rd answers for the job behind the marker. */
const nzb2rdAnswers = (job: any, status = 200) => {
	global.fetch = vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		json: async () => job,
	}) as any;
};

beforeEach(() => {
	vi.clearAllMocks();
	mockRepo.getNzb2rdTransfers = vi.fn().mockResolvedValue([pendingRecord]);
	mockRepo.removeNzb2rdTransfer = vi.fn().mockResolvedValue(undefined);
	mockRepo.recordNzb2rdTransferFailed = vi.fn().mockResolvedValue(undefined);
	mockRegister.mockResolvedValue(true);
});

// A `pending` marker used to be permanent: nothing ever wrote a failure, and the
// completion flip only happened if a browser was still polling that job with its
// release id. Both stale states render as a disabled "Running" button for every
// user, so the marker has to be checked against the job it names.
describe('POST /api/nzb2rd/registered — reconciling stale markers', () => {
	// Deleting the marker unblocked the resubmit but threw away the only thing
	// worth telling the next viewer: this release was tried and did not work. The
	// marker is kept as `failed` so the row can offer an informed Retry — and it
	// still blocks nothing, because the dedup check re-reads the job.
	it('records the failure and hands back its reason, rather than dropping the marker', async () => {
		nzb2rdAnswers({ id: 'job-1', status: 'failed', error: 'RD refused the credentials' });

		const res = await run();

		expect(mockRepo.recordNzb2rdTransferFailed).toHaveBeenCalledWith(
			'release-1',
			'job-1',
			'tt1308738',
			'RD refused the credentials',
			undefined
		);
		expect(mockRepo.removeNzb2rdTransfer).not.toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith({
			transfers: [
				expect.objectContaining({
					releaseId: 'release-1',
					status: 'failed',
					error: 'RD refused the credentials',
				}),
			],
		});
	});

	// nzb2rd does not always say why, and a Retry with no reason is still better
	// than a disabled button — it just must not invent one.
	it('records a reasonless failure without inventing a reason', async () => {
		nzb2rdAnswers({ id: 'job-1', status: 'failed' });

		const res = await run();

		expect(mockRepo.recordNzb2rdTransferFailed).toHaveBeenCalledWith(
			'release-1',
			'job-1',
			'tt1308738',
			undefined,
			undefined
		);
		expect(res.json).toHaveBeenCalledWith({
			transfers: [expect.objectContaining({ status: 'failed', error: null })],
		});
	});

	// A marker already settled as failed is terminal: re-asking nzb2rd about it
	// on every page load would spend the reconcile budget re-reading answers that
	// cannot change, and starve the `pending` markers that still need it.
	it('does not re-check a marker that is already failed', async () => {
		mockRepo.getNzb2rdTransfers = vi
			.fn()
			.mockResolvedValue([
				{ ...pendingRecord, status: 'failed' as const, error: 'article missing' },
			]);
		global.fetch = vi.fn() as any;

		const res = await run();

		expect(global.fetch).not.toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith({
			transfers: [expect.objectContaining({ status: 'failed', error: 'article missing' })],
		});
	});

	it('drops a marker whose job nzb2rd no longer has', async () => {
		nzb2rdAnswers({ error: 'not found' }, 404);

		const res = await run();

		expect(mockRepo.removeNzb2rdTransfer).toHaveBeenCalledWith('release-1');
		expect(res.json).toHaveBeenCalledWith({ transfers: [] });
	});

	// Worth more than the failed case: the content is already in RD, so the row
	// goes from unsendable to an instant cached add.
	it('promotes a marker whose job finished while nobody was watching', async () => {
		nzb2rdAnswers({
			id: 'job-1',
			status: 'completed',
			info_hash: HASH.toUpperCase(),
			imdb_id: 'tt1308738',
		});

		const res = await run();

		expect(mockRegister).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'job-1' }),
			undefined,
			undefined,
			'release-1'
		);
		expect(res.json).toHaveBeenCalledWith({
			transfers: [
				{
					releaseId: 'release-1',
					status: 'completed',
					infoHash: HASH,
					jobId: 'job-1',
					error: null,
				},
			],
		});
		expect(mockRepo.removeNzb2rdTransfer).not.toHaveBeenCalled();
	});

	// The marker says only `pending`, which covers both waiting in line and being
	// fetched — and against the live queue on 2026-08-29 that was 670 waiting to
	// 13 working, the oldest queued 8 days. Reconciling already has the job in
	// hand, so it hands back where the job actually is.
	it('reports where a genuinely running job stands, and leaves the marker alone', async () => {
		nzb2rdAnswers({
			id: 'job-1',
			status: 'fetching',
			done_bytes: 3,
			total_bytes: 4,
			status_message: null,
			queue: null,
		});

		const res = await run();

		expect(mockRepo.removeNzb2rdTransfer).not.toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith({
			transfers: [
				{
					releaseId: 'release-1',
					status: 'pending',
					infoHash: null,
					jobId: 'job-1',
					error: null,
					progress: {
						status: 'fetching',
						status_message: null,
						done_bytes: 3,
						total_bytes: 4,
						queue: null,
					},
				},
			],
		});
	});

	it('passes the queue place through so the row can say where in line it is', async () => {
		nzb2rdAnswers({ id: 'job-1', status: 'pending', queue: { position: 479, waiting: 670 } });

		const res = await run();

		expect((res.json as any).mock.calls[0][0].transfers[0].progress).toMatchObject({
			status: 'pending',
			queue: { position: 479, waiting: 670 },
		});
	});

	// The job record also carries the submitter's RD account id and the internal
	// webseed URL; this route is public and unauthenticated.
	it('never passes anything but the progress fields back', async () => {
		nzb2rdAnswers({
			id: 'job-1',
			status: 'pending',
			rd_user_id: 'rd:3214414',
			webseed_url: 'http://10.0.0.1/webseed/secret',
			owner_hash: 'deadbeef',
		});

		const res = await run();

		const body = JSON.stringify((res.json as any).mock.calls[0][0]);
		expect(body).not.toContain('rd:3214414');
		expect(body).not.toContain('webseed');
		expect(body).not.toContain('deadbeef');
	});

	// nzb2rd shipping a field in a shape DMM does not expect must not become a
	// `queue.position` of undefined that the row then renders as "undefinedth".
	it('drops a malformed queue place rather than passing it on', async () => {
		nzb2rdAnswers({ id: 'job-1', status: 'pending', queue: { position: '3rd' } });

		const res = await run();

		expect((res.json as any).mock.calls[0][0].transfers[0].progress.queue).toBeNull();
	});

	// Failing open matters more here than healing: dropping the marker for a job
	// that is actually running lets a second Usenet fetch start, which is the
	// whole cost this mechanism exists to avoid.
	it('leaves a marker alone when nzb2rd cannot be reached', async () => {
		global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;

		const res = await run();

		expect(mockRepo.removeNzb2rdTransfer).not.toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith({
			transfers: [
				{
					releaseId: 'release-1',
					status: 'pending',
					infoHash: null,
					jobId: 'job-1',
					error: null,
				},
			],
		});
	});

	it('never re-checks a marker that already says completed', async () => {
		mockRepo.getNzb2rdTransfers = vi
			.fn()
			.mockResolvedValue([
				{ ...pendingRecord, status: 'completed' as const, infoHash: HASH },
			]);
		global.fetch = vi.fn() as any;

		const res = await run();

		expect(global.fetch).not.toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith({
			transfers: [
				{
					releaseId: 'release-1',
					status: 'completed',
					infoHash: HASH,
					jobId: 'job-1',
					error: null,
				},
			],
		});
	});

	// A page shows tens of results and any of them could carry a marker, so the
	// fan-out onto nzb2rd has to be capped however many come back stale.
	it('re-checks at most eight markers in one request', async () => {
		mockRepo.getNzb2rdTransfers = vi.fn().mockResolvedValue(
			Array.from({ length: 20 }, (_, i) => ({
				...pendingRecord,
				releaseId: `release-${i}`,
				jobId: `job-${i}`,
			}))
		);
		nzb2rdAnswers({ id: 'job-x', status: 'fetching' });

		const res = await run(Array.from({ length: 20 }, (_, i) => `release-${i}`));

		expect(global.fetch).toHaveBeenCalledTimes(8);
		expect((res.json as any).mock.calls[0][0].transfers).toHaveLength(20);
	});
});
