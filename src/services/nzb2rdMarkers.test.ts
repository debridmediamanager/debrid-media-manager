import {
	PENDING_MARKER_BATCH,
	reconcileNzb2rdMarkers,
	settleNzb2rdMarker,
	WAITER_MAX_AGE_MS,
} from '@/services/nzb2rdMarkers';
import { repository } from '@/services/repository';
import { deliverNzb2rdWaiters, registerCompletedNzb2rdJob } from '@/services/transferRegistration';
import recorded from '@/test/fixtures/transfers/waiter-markers-2026-10-07.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/transferRegistration', () => ({
	registerCompletedNzb2rdJob: vi.fn(),
	deliverNzb2rdWaiters: vi.fn(),
}));

/**
 * The cron's pass over Usenet markers, driven by what production held on
 * 2026-10-07 (`fixtures/transfers/waiter-markers-2026-10-07.json`): three waiter
 * lists, each holding one account's Real-Debrid credentials, behind markers
 * that had read `pending` since 2026-09-17..22. Two of those jobs had been
 * deleted on 2026-09-22 and the third was 24th of 1188 in nzb2rd's queue.
 */

const NZB2RD = 'http://nzb2rd.test:3200';
const NOW = Date.parse(recorded.recordedAt);
const jobs = recorded.jobs as Record<string, any>;
const markerOf = (label: string) => recorded.markers.find((m) => m.jobId === label)! as any;
const waiterLists = () =>
	Object.entries(recorded.waiters).map(([releaseId, waiters]) => ({
		releaseId,
		waiters: waiters as any[],
		updatedAt: new Date(Math.max(...waiters.map((w) => w.queuedAt))),
	}));

const mockRepo = vi.mocked(repository);
const mockRegister = vi.mocked(registerCompletedNzb2rdJob);
const mockDeliver = vi.mocked(deliverNzb2rdWaiters);

/** nzb2rd answering `GET /jobs/:id` the way it did that day. */
const nzb2rdAsRecorded = (overrides: Record<string, any> = {}) =>
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			const label = decodeURIComponent(url.slice(`${NZB2RD}/jobs/`.length));
			const job = label in overrides ? overrides[label] : jobs[label];
			if (!job) return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
			return { ok: true, status: 200, json: async () => ({ ...job }) };
		})
	);

beforeEach(() => {
	vi.clearAllMocks();
	process.env.NZB2RD_URL = NZB2RD;
	mockRepo.listNzb2rdWaiterLists = vi.fn().mockResolvedValue(waiterLists());
	mockRepo.getNzb2rdTransfer = vi.fn(
		async (releaseId: string) => recorded.markers.find((m) => m.releaseId === releaseId) as any
	);
	mockRepo.sampleNzb2rdPendingMarkers = vi.fn().mockResolvedValue([]);
	mockRepo.pruneNzb2rdWaiters = vi.fn().mockResolvedValue(true);
	mockRepo.clearNzb2rdWaiters = vi.fn().mockResolvedValue(undefined);
	mockRepo.removeNzb2rdTransfer = vi.fn().mockResolvedValue(undefined);
	mockRepo.recordNzb2rdTransferFailed = vi.fn().mockResolvedValue(undefined);
	mockRegister.mockResolvedValue(false);
	mockDeliver.mockResolvedValue(0);
	nzb2rdAsRecorded();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('reconcileNzb2rdMarkers — the waiter lists production held', () => {
	it('drops the two lists behind deleted jobs and keeps the one behind a queued job', async () => {
		const result = await reconcileNzb2rdMarkers({ now: NOW });

		// Removing the marker drops its waiter list with it.
		expect(mockRepo.removeNzb2rdTransfer.mock.calls.map(([id]) => id).sort()).toEqual([
			markerOf('nzb2rd-W1').releaseId,
			markerOf('nzb2rd-W2').releaseId,
		]);
		expect(mockRepo.pruneNzb2rdWaiters).not.toHaveBeenCalled();
		expect(mockRepo.clearNzb2rdWaiters).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			waiterLists: 3,
			expiredWaiters: 0,
			checked: 3,
			removed: 2,
			live: 1,
			unknown: 0,
		});
	});

	// nzb2rd has no total job timeout, so an account behind a job that never ends
	// would keep its credentials stored forever without a ceiling of its own.
	it('lets no waiting account outlive WAITER_MAX_AGE_MS, however its job is doing', async () => {
		const queuedAt = recorded.waiters['ix:release-3'][0].queuedAt;

		const result = await reconcileNzb2rdMarkers({ now: queuedAt + WAITER_MAX_AGE_MS });

		expect(mockRepo.pruneNzb2rdWaiters).toHaveBeenCalledWith(
			'ix:release-3',
			[],
			new Date(queuedAt)
		);
		expect(result.expiredWaiters).toBe(3);
		// Nothing is left to deliver to, so the queued job's marker is not asked about.
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('keeps a waiting account one tick short of the ceiling', async () => {
		const queuedAt = recorded.waiters['ix:release-3'][0].queuedAt;

		await reconcileNzb2rdMarkers({ now: queuedAt + WAITER_MAX_AGE_MS - 1 });

		expect(mockRepo.pruneNzb2rdWaiters).not.toHaveBeenCalledWith(
			'ix:release-3',
			expect.anything(),
			expect.anything()
		);
	});

	it('leaves a list alone when someone joined it after it was read', async () => {
		mockRepo.pruneNzb2rdWaiters = vi.fn().mockResolvedValue(false);
		const queuedAt = recorded.waiters['ix:release-3'][0].queuedAt;

		const result = await reconcileNzb2rdMarkers({ now: queuedAt + WAITER_MAX_AGE_MS });

		expect(result.expiredWaiters).toBe(0);
		expect(mockRepo.clearNzb2rdWaiters).not.toHaveBeenCalled();
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('hands a completed release to a list its completion missed', async () => {
		const hash = jobs['nzb2rd-C1'].info_hash;
		mockRepo.getNzb2rdTransfer = vi.fn(async (releaseId: string) => ({
			...markerOf('nzb2rd-W3'),
			releaseId,
			status: 'completed',
			infoHash: hash,
		}));
		mockDeliver.mockResolvedValue(1);

		const result = await reconcileNzb2rdMarkers({ now: NOW });

		expect(mockDeliver).toHaveBeenCalledTimes(3);
		expect(mockDeliver).toHaveBeenCalledWith('ix:release-3', hash, 'nzb2rd-W3');
		expect(result.delivered).toBe(3);
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('drops a list whose marker is gone or already failed', async () => {
		mockRepo.getNzb2rdTransfer = vi.fn(async (releaseId: string) =>
			releaseId === 'ix:release-1'
				? null
				: ({ ...markerOf('nzb2rd-W2'), status: 'failed' } as any)
		);

		const result = await reconcileNzb2rdMarkers({ now: NOW });

		expect(mockRepo.clearNzb2rdWaiters.mock.calls.map(([id]) => id).sort()).toEqual([
			'ix:release-1',
			'ix:release-2',
			'ix:release-3',
		]);
		expect(result.orphanedLists).toBe(3);
		expect(global.fetch).not.toHaveBeenCalled();
	});
});

describe('reconcileNzb2rdMarkers — pending markers nobody looks at', () => {
	beforeEach(() => {
		mockRepo.listNzb2rdWaiterLists = vi.fn().mockResolvedValue([]);
	});

	it('settles a sample of them against nzb2rd', async () => {
		mockRepo.sampleNzb2rdPendingMarkers = vi
			.fn()
			.mockResolvedValue([
				markerOf('nzb2rd-D1'),
				markerOf('nzb2rd-C1'),
				markerOf('nzb2rd-W3'),
			]);

		const result = await reconcileNzb2rdMarkers({ now: NOW });

		expect(mockRepo.sampleNzb2rdPendingMarkers).toHaveBeenCalledWith(PENDING_MARKER_BATCH);
		expect(mockRepo.removeNzb2rdTransfer).toHaveBeenCalledWith(
			markerOf('nzb2rd-D1').releaseId,
			'nzb2rd-D1'
		);
		expect(mockRegister).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'nzb2rd-C1', info_hash: jobs['nzb2rd-C1'].info_hash }),
			undefined,
			undefined,
			markerOf('nzb2rd-C1').releaseId
		);
		expect(result).toMatchObject({ checked: 3, removed: 1, completed: 1, live: 1 });
	});

	it('records a failed job with nzb2rd’s reason', async () => {
		const marker = markerOf('nzb2rd-W3');
		mockRepo.sampleNzb2rdPendingMarkers = vi.fn().mockResolvedValue([marker]);
		nzb2rdAsRecorded({
			'nzb2rd-W3': { ...jobs['nzb2rd-W3'], status: 'failed', error: 'par2 exited 2' },
		});

		const result = await reconcileNzb2rdMarkers({ now: NOW });

		expect(mockRepo.recordNzb2rdTransferFailed).toHaveBeenCalledWith(
			marker.releaseId,
			'nzb2rd-W3',
			marker.imdbId,
			'par2 exited 2',
			marker.title
		);
		expect(result.failed).toBe(1);
	});

	it('drops a marker whose job nzb2rd no longer has at all', async () => {
		const marker = { ...markerOf('nzb2rd-W3'), jobId: 'nzb2rd-purged' };
		mockRepo.sampleNzb2rdPendingMarkers = vi.fn().mockResolvedValue([marker]);

		const result = await reconcileNzb2rdMarkers({ now: NOW });

		expect(mockRepo.removeNzb2rdTransfer).toHaveBeenCalledWith(
			marker.releaseId,
			'nzb2rd-purged'
		);
		expect(result.removed).toBe(1);
	});

	// Dropping the marker of a job that is still running lets a second Usenet
	// fetch of the same release start.
	it('fails open when nzb2rd gives no answer', async () => {
		mockRepo.sampleNzb2rdPendingMarkers = vi
			.fn()
			.mockResolvedValue([markerOf('nzb2rd-W1'), markerOf('nzb2rd-D1')]);
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

		const result = await reconcileNzb2rdMarkers({ now: NOW });

		expect(mockRepo.removeNzb2rdTransfer).not.toHaveBeenCalled();
		expect(result).toMatchObject({ checked: 2, unknown: 2 });
	});

	it('fails open on an error status too', async () => {
		mockRepo.sampleNzb2rdPendingMarkers = vi.fn().mockResolvedValue([markerOf('nzb2rd-W1')]);
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) })
		);

		const result = await reconcileNzb2rdMarkers({ now: NOW });

		expect(mockRepo.removeNzb2rdTransfer).not.toHaveBeenCalled();
		expect(result.unknown).toBe(1);
	});

	it('checks a marker once when it is both behind a waiter list and in the sample', async () => {
		mockRepo.listNzb2rdWaiterLists = vi.fn().mockResolvedValue(waiterLists());
		mockRepo.sampleNzb2rdPendingMarkers = vi.fn().mockResolvedValue([markerOf('nzb2rd-W3')]);

		const result = await reconcileNzb2rdMarkers({ now: NOW });

		expect(result.checked).toBe(3);
		expect(global.fetch).toHaveBeenCalledTimes(3);
	});
});

describe('settleNzb2rdMarker', () => {
	it('answers live with the job for one still in line', async () => {
		const settled = await settleNzb2rdMarker(markerOf('nzb2rd-W3'));

		expect(settled).toEqual({
			outcome: 'live',
			job: expect.objectContaining({ queue: { position: 24, waiting: 1188 } }),
		});
		expect(mockRepo.removeNzb2rdTransfer).not.toHaveBeenCalled();
	});
});
