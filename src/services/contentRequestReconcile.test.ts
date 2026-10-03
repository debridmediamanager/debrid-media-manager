import { ORPHANED_CLAIM_MS, reconcileContentRequests } from '@/services/contentRequestReconcile';
import { repository as db } from '@/services/repository';
import completedJob from '@/test/fixtures/contentRequests/job-completed.json';
import uncachedJob from '@/test/fixtures/contentRequests/job-failed-uncached.json';
import claimedOnCancelledJob from '@/test/fixtures/debridUploader/claimed-request-cancelled-job.json';
import cancelledJob from '@/test/fixtures/debridUploader/job-cancelled-claimed-request.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');

const mockDb = vi.mocked(db);
const SERVER = 'http://100.122.58.7:3100';
const NOW = Date.parse('2026-09-24T12:00:00Z');

const claimed = (over: Record<string, unknown> = {}) => ({
	id: 'req-1',
	hash: 'abb28cb1dc25c1e2fa27aac9d1fe70d4c02be8f2',
	imdbId: 'tt1228322',
	title: 'Some Release',
	mediaType: 'movie',
	status: 'claimed',
	requesterId: 'asker',
	fulfillerId: 'helper',
	jobId: uncachedJob.id,
	jobHost: SERVER,
	createdAt: new Date('2026-09-24T10:32:00Z'),
	updatedAt: new Date('2026-09-24T10:32:11Z'),
	...over,
});

/** The uploader's `GET /jobs/:id`, answering from recorded bodies. */
const uploaderSays = (answers: Record<string, { status?: number; body?: unknown }>) => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			const answer = answers[url.split('/jobs/')[1]];
			if (!answer) throw new Error('connection refused');
			const status = answer.status ?? 200;
			return { ok: status >= 200 && status < 300, status, json: async () => answer.body };
		})
	);
};

beforeEach(() => {
	vi.clearAllMocks();
	process.env.DEBRID_UPLOADER_URLS = SERVER;
	mockDb.releaseContentRequest = vi.fn().mockResolvedValue(true);
	mockDb.settleContentRequestDelivered = vi.fn().mockResolvedValue(true);
	mockDb.touchClaimedContentRequest = vi.fn().mockResolvedValue(undefined);
});

describe('reconcileContentRequests', () => {
	// The defect: a request was marked sent when its job was queued, and a job
	// that then failed `uncached` (219 of 369 on 2026-09-24) left the board for
	// good. It has to come back, carrying the uploader's reason.
	it('puts a request whose job failed back on the board with the reason', async () => {
		mockDb.listClaimedContentRequests = vi.fn().mockResolvedValue([claimed()]);
		uploaderSays({ [uncachedJob.id]: { body: uncachedJob } });

		const result = await reconcileContentRequests(20, NOW);

		expect(mockDb.releaseContentRequest).toHaveBeenCalledWith(
			'req-1',
			'uncached',
			uncachedJob.id
		);
		expect(mockDb.settleContentRequestDelivered).not.toHaveBeenCalled();
		expect(result).toMatchObject({ checked: 1, reopened: 1, delivered: 0 });
	});

	it('marks a request fulfilled only once its job has completed', async () => {
		mockDb.listClaimedContentRequests = vi
			.fn()
			.mockResolvedValue([claimed({ jobId: completedJob.id })]);
		uploaderSays({ [completedJob.id]: { body: completedJob } });

		const result = await reconcileContentRequests(20, NOW);

		expect(mockDb.settleContentRequestDelivered).toHaveBeenCalledWith('req-1', completedJob.id);
		expect(mockDb.releaseContentRequest).not.toHaveBeenCalled();
		expect(result.delivered).toBe(1);
	});

	// Card 109. The fulfiller cancelled this job on 2026-09-21; the uploader
	// kept answering `pending` (with `deleted: 1`), so the request sat claimed
	// and off the board for twelve days. All four claims open on 2026-10-03
	// were waiting on a cancelled job.
	it('puts a request whose job was cancelled back on the board', async () => {
		mockDb.listClaimedContentRequests = vi.fn().mockResolvedValue([
			{
				...claimedOnCancelledJob,
				createdAt: new Date(claimedOnCancelledJob.createdAt),
				updatedAt: new Date(claimedOnCancelledJob.updatedAt),
			},
		]);
		uploaderSays({ [cancelledJob.id]: { body: cancelledJob } });

		const result = await reconcileContentRequests(20, NOW);

		expect(mockDb.releaseContentRequest).toHaveBeenCalledWith(
			claimedOnCancelledJob.id,
			'cancelled',
			cancelledJob.id
		);
		expect(mockDb.touchClaimedContentRequest).not.toHaveBeenCalled();
		expect(result).toMatchObject({ reopened: 1, inFlight: 0 });
	});

	it('leaves a job still running alone and re-queues it', async () => {
		mockDb.listClaimedContentRequests = vi.fn().mockResolvedValue([claimed()]);
		uploaderSays({ [uncachedJob.id]: { body: { ...uncachedJob, status: 'uploading' } } });

		const result = await reconcileContentRequests(20, NOW);

		expect(mockDb.releaseContentRequest).not.toHaveBeenCalled();
		expect(mockDb.settleContentRequestDelivered).not.toHaveBeenCalled();
		expect(mockDb.touchClaimedContentRequest).toHaveBeenCalledWith('req-1');
		expect(result.inFlight).toBe(1);
	});

	// An uploader outage must not reopen every request at once and send each to
	// a second fulfiller while the first transfer may still land.
	it('concludes nothing when the host cannot be reached', async () => {
		mockDb.listClaimedContentRequests = vi.fn().mockResolvedValue([claimed()]);
		uploaderSays({});

		const result = await reconcileContentRequests(20, NOW);

		expect(mockDb.releaseContentRequest).not.toHaveBeenCalled();
		expect(result.unreachable).toBe(1);
	});

	it('reopens a request whose job the host no longer knows', async () => {
		mockDb.listClaimedContentRequests = vi.fn().mockResolvedValue([claimed()]);
		uploaderSays({ [uncachedJob.id]: { status: 404, body: { error: 'not found' } } });

		await reconcileContentRequests(20, NOW);

		expect(mockDb.releaseContentRequest).toHaveBeenCalledWith(
			'req-1',
			'the uploader lost the transfer',
			uncachedJob.id
		);
	});

	it('reopens a claim on a host that has left the pool without fetching it', async () => {
		mockDb.listClaimedContentRequests = vi
			.fn()
			.mockResolvedValue([claimed({ jobHost: 'http://100.64.0.9:3100' })]);
		uploaderSays({});

		await reconcileContentRequests(20, NOW);

		expect(fetch).not.toHaveBeenCalled();
		expect(mockDb.releaseContentRequest).toHaveBeenCalledWith(
			'req-1',
			'the uploader host was retired',
			uncachedJob.id
		);
	});

	it('reopens a claim that never got a job, but only once it is clearly abandoned', async () => {
		const fresh = claimed({
			id: 'fresh',
			jobId: null,
			jobHost: null,
			updatedAt: new Date(NOW - 60_000),
		});
		const stale = claimed({
			id: 'stale',
			jobId: null,
			jobHost: null,
			updatedAt: new Date(NOW - ORPHANED_CLAIM_MS - 1),
		});
		mockDb.listClaimedContentRequests = vi.fn().mockResolvedValue([fresh, stale]);

		await reconcileContentRequests(20, NOW);

		expect(mockDb.releaseContentRequest).toHaveBeenCalledTimes(1);
		expect(mockDb.releaseContentRequest).toHaveBeenCalledWith(
			'stale',
			'the transfer never started'
		);
	});
});
