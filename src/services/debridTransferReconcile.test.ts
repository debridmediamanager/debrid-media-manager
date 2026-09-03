import { reconcileDebridTransfers } from '@/services/debridTransferReconcile';
import { repository as db } from '@/services/repository';
import { registerCompletedDebridJob } from '@/services/transferRegistration';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/transferRegistration', () => ({
	registerCompletedDebridJob: vi.fn().mockResolvedValue(true),
}));

const mockDb = vi.mocked(db);
const mockRegister = vi.mocked(registerCompletedDebridJob);

const SERVER = 'http://100.122.58.7:3100';

const pendingRecord = (originalHash: string, jobId: string) => ({
	originalHash,
	jobId,
	imdbId: 'tt0190641',
	status: 'pending' as const,
	updatedAt: 1_756_000_000_000,
});

/** One uploader answer per job id, in the shape `lookupJob` reads. */
const uploaderSays = (answers: Record<string, { status?: number; body?: unknown }>) => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			const jobId = url.split('/jobs/')[1];
			const answer = answers[jobId];
			if (!answer) throw new Error('connection refused');
			const status = answer.status ?? 200;
			return { ok: status >= 200 && status < 300, status, json: async () => answer.body };
		})
	);
};

beforeEach(() => {
	vi.clearAllMocks();
	process.env.DEBRID_UPLOADER_URLS = SERVER;
	mockDb.removeDebridTransfer = vi.fn().mockResolvedValue(undefined);
	mockDb.getDebridJobServer = vi.fn().mockResolvedValue(SERVER);
	mockRegister.mockResolvedValue(true);
});

// The whole reason this exists: registration used to happen only while a browser
// sat on the page polling, so closing the tab lost the transfer permanently.
// Measured on production 2026-09-03 — 344 of 1499 `pending` mappings belonged to
// jobs that had actually completed, and only 9 of those had reached `Available`.
describe('reconcileDebridTransfers', () => {
	it('registers a completed job that no browser ever polled', async () => {
		const record = pendingRecord('a'.repeat(40), 'job-done');
		mockDb.listPendingDebridTransfers = vi.fn().mockResolvedValue([record]);
		uploaderSays({ 'job-done': { body: { id: 'job-done', status: 'completed' } } });

		const result = await reconcileDebridTransfers();

		expect(mockRegister).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'job-done', status: 'completed' }),
			undefined,
			undefined,
			SERVER
		);
		expect(result).toMatchObject({ checked: 1, registered: 1, pruned: 0 });
	});

	// A mapping that can never complete is worse than none: `isTransferStillValid`
	// reads a live-but-unfinished job as "still in progress" and refuses every
	// later submission of that hash, so the content is never re-transferable.
	it('prunes the mapping for a failed job', async () => {
		const record = pendingRecord('b'.repeat(40), 'job-failed');
		mockDb.listPendingDebridTransfers = vi.fn().mockResolvedValue([record]);
		uploaderSays({ 'job-failed': { body: { id: 'job-failed', status: 'failed' } } });

		const result = await reconcileDebridTransfers();

		expect(mockDb.removeDebridTransfer).toHaveBeenCalledWith('b'.repeat(40));
		expect(result).toMatchObject({ pruned: 1, registered: 0 });
	});

	// 452 of the pending mappings pointed at jobs created on the retired debrid01.
	// The surviving host answers 404 for those, which is a definite answer.
	it('prunes the mapping for a job the uploader no longer has', async () => {
		const record = pendingRecord('c'.repeat(40), 'job-gone');
		mockDb.listPendingDebridTransfers = vi.fn().mockResolvedValue([record]);
		uploaderSays({ 'job-gone': { status: 404 } });

		const result = await reconcileDebridTransfers();

		expect(mockDb.removeDebridTransfer).toHaveBeenCalledWith('c'.repeat(40));
		expect(result).toMatchObject({ pruned: 1 });
	});

	it('leaves a job that is still running', async () => {
		const record = pendingRecord('d'.repeat(40), 'job-live');
		mockDb.listPendingDebridTransfers = vi.fn().mockResolvedValue([record]);
		uploaderSays({ 'job-live': { body: { id: 'job-live', status: 'uploading' } } });

		const result = await reconcileDebridTransfers();

		expect(mockDb.removeDebridTransfer).not.toHaveBeenCalled();
		expect(mockRegister).not.toHaveBeenCalled();
		expect(result).toMatchObject({ inFlight: 1 });
	});

	// The dangerous direction. An uploader outage answers nothing for every job at
	// once; concluding "gone" there would wipe the mapping for the whole backlog
	// and send a fleet of redundant transfers at TorBox when it came back.
	it('concludes nothing about a job it cannot reach', async () => {
		const record = pendingRecord('e'.repeat(40), 'job-unreachable');
		mockDb.listPendingDebridTransfers = vi.fn().mockResolvedValue([record]);
		uploaderSays({});

		const result = await reconcileDebridTransfers();

		expect(mockDb.removeDebridTransfer).not.toHaveBeenCalled();
		expect(result).toMatchObject({ unreachable: 1, pruned: 0 });
	});

	it('treats a 5xx from the owning server as unreachable, not as a failure', async () => {
		const record = pendingRecord('f'.repeat(40), 'job-5xx');
		mockDb.listPendingDebridTransfers = vi.fn().mockResolvedValue([record]);
		uploaderSays({ 'job-5xx': { status: 502 } });

		const result = await reconcileDebridTransfers();

		expect(mockDb.removeDebridTransfer).not.toHaveBeenCalled();
		expect(result).toMatchObject({ unreachable: 1 });
	});

	// One bad row must not end the tick — the backlog drains 25 at a time, and a
	// registration that throws would otherwise strand everything behind it.
	it('keeps going when one registration throws', async () => {
		mockDb.listPendingDebridTransfers = vi
			.fn()
			.mockResolvedValue([
				pendingRecord('1'.repeat(40), 'job-bad'),
				pendingRecord('2'.repeat(40), 'job-good'),
			]);
		uploaderSays({
			'job-bad': { body: { id: 'job-bad', status: 'completed' } },
			'job-good': { body: { id: 'job-good', status: 'completed' } },
		});
		mockRegister.mockRejectedValueOnce(new Error('db down'));

		const result = await reconcileDebridTransfers();

		expect(result).toMatchObject({ checked: 2, registered: 1 });
	});

	it('asks for a bounded batch rather than the whole backlog', async () => {
		mockDb.listPendingDebridTransfers = vi.fn().mockResolvedValue([]);

		await reconcileDebridTransfers(5);

		expect(mockDb.listPendingDebridTransfers).toHaveBeenCalledWith(5);
	});
});
