import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createDebridUploaderJob,
	getTrackedDebridUploaderJobs,
	isDuplicateResponse,
	isTerminalDebridUploaderStatus,
	runDebridTransferToRd,
	trackDebridUploaderJob,
	TrackedDebridUploaderJob,
	untrackDebridUploaderJob,
} from './debridUploader';

vi.mock('react-hot-toast', () => ({
	toast: Object.assign(vi.fn(), {
		loading: vi.fn(() => 'toast-id'),
		success: vi.fn(),
		error: vi.fn(),
	}),
}));

const makeJob = (id: string): TrackedDebridUploaderJob => ({
	id,
	hash: 'a'.repeat(40),
	imdbId: 'tt1234567',
	title: `Job ${id}`,
	returnPath: '/movie/tt1234567',
	createdAt: 1700000000000,
});

beforeEach(() => {
	localStorage.clear();
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('debridUploader job tracking', () => {
	it('returns an empty list when nothing is tracked', () => {
		expect(getTrackedDebridUploaderJobs()).toEqual([]);
	});

	it('tracks jobs newest-first and untracks by id', () => {
		trackDebridUploaderJob(makeJob('one'));
		trackDebridUploaderJob(makeJob('two'));

		expect(getTrackedDebridUploaderJobs().map((j) => j.id)).toEqual(['two', 'one']);

		untrackDebridUploaderJob('two');
		expect(getTrackedDebridUploaderJobs().map((j) => j.id)).toEqual(['one']);
	});

	it('dedupes by id, keeping the newest entry', () => {
		trackDebridUploaderJob(makeJob('one'));
		trackDebridUploaderJob({ ...makeJob('one'), title: 'updated' });

		const jobs = getTrackedDebridUploaderJobs();
		expect(jobs).toHaveLength(1);
		expect(jobs[0].title).toBe('updated');
	});

	it('caps the list at 100 entries', () => {
		for (let i = 0; i < 105; i++) {
			trackDebridUploaderJob(makeJob(`job-${i}`));
		}
		const jobs = getTrackedDebridUploaderJobs();
		expect(jobs).toHaveLength(100);
		expect(jobs[0].id).toBe('job-104');
	});

	it('survives corrupted storage', () => {
		localStorage.setItem('debridUploader:jobs', 'not-json');
		expect(getTrackedDebridUploaderJobs()).toEqual([]);

		localStorage.setItem('debridUploader:jobs', '{"an":"object"}');
		expect(getTrackedDebridUploaderJobs()).toEqual([]);
	});

	it('knows which statuses are terminal', () => {
		expect(isTerminalDebridUploaderStatus('completed')).toBe(true);
		expect(isTerminalDebridUploaderStatus('failed')).toBe(true);
		expect(isTerminalDebridUploaderStatus('pending')).toBe(false);
		expect(isTerminalDebridUploaderStatus('downloading')).toBe(false);
		expect(isTerminalDebridUploaderStatus('uploading')).toBe(false);
	});
});

describe('createDebridUploaderJob', () => {
	it('returns the created job', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ id: 'job-1', status: 'pending' }),
			})
		);
		const job = await createDebridUploaderJob({
			hash: 'a'.repeat(40),
			imdbId: 'tt1418646',
			rdKey: 'k',
			adKey: 'ad',
		});
		expect(isDuplicateResponse(job)).toBe(false);
	});

	it('recognises a duplicate response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					duplicate: 'completed',
					rewrittenHash: 'b'.repeat(40),
					jobId: 'j',
				}),
			})
		);
		const job = await createDebridUploaderJob({
			hash: 'a'.repeat(40),
			imdbId: 'tt1418646',
			rdKey: 'k',
			adKey: 'ad',
		});
		expect(isDuplicateResponse(job)).toBe(true);
	});

	it('surfaces the server error message', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 502,
				json: async () => ({ error: 'all servers unreachable' }),
			})
		);
		await expect(
			createDebridUploaderJob({
				hash: 'a'.repeat(40),
				imdbId: 'tt1418646',
				rdKey: 'k',
				adKey: 'ad',
			})
		).rejects.toThrow('all servers unreachable');
	});
});

describe('runDebridTransferToRd', () => {
	it('tracks a duplicate job so it appears on the Transfers page', async () => {
		const hash = 'c'.repeat(40);
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					duplicate: 'in_progress',
					rewrittenHash: null,
					jobId: 'dup-job-1',
				}),
			})
		);

		const outcome = await runDebridTransferToRd({
			hash,
			imdbId: 'tt1234567',
			rdKey: 'rdkey',
			adKey: 'adkey',
			title: 'Test Movie',
			returnPath: '/movie/tt1234567',
		});

		expect(outcome).toBe('duplicate');
		const tracked = getTrackedDebridUploaderJobs();
		expect(tracked).toHaveLength(1);
		expect(tracked[0].id).toBe('dup-job-1');
		expect(tracked[0].hash).toBe(hash);
	});

	it('tracks a completed duplicate too', async () => {
		const hash = 'd'.repeat(40);
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					duplicate: 'completed',
					rewrittenHash: 'e'.repeat(40),
					jobId: 'dup-job-2',
				}),
			})
		);

		await runDebridTransferToRd({
			hash,
			imdbId: 'tt9999999',
			rdKey: 'rdkey',
			adKey: 'adkey',
		});

		const tracked = getTrackedDebridUploaderJobs();
		expect(tracked).toHaveLength(1);
		expect(tracked[0].id).toBe('dup-job-2');
	});
});
