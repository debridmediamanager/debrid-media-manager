import { toast } from 'react-hot-toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createDebridUploaderJob,
	getTrackedDebridUploaderJobs,
	isDuplicateResponse,
	isTerminalDebridUploaderStatus,
	markTransferredHashes,
	needsRdHandoff,
	runDebridTransferToRd,
	trackDebridUploaderJob,
	TrackedDebridUploaderJob,
	untrackDebridUploaderJob,
	updateTrackedDebridUploaderJob,
} from './debridUploader';
import { toastRdUnderway, TRANSFER_TOAST_MS } from './transferPhase';

vi.mock('react-hot-toast', () => ({
	toast: Object.assign(vi.fn(), {
		loading: vi.fn(() => 'toast-id'),
		success: vi.fn(),
		error: vi.fn(),
	}),
}));

const mockAddHashAsMagnet = vi.fn().mockResolvedValue('rd-torrent-id');
const mockSelectFiles = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services/realDebrid', () => ({
	addHashAsMagnet: (...args: any[]) => mockAddHashAsMagnet(...args),
	selectFiles: (...args: any[]) => mockSelectFiles(...args),
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

	it('patches an entry in place, keeping its position', () => {
		trackDebridUploaderJob(makeJob('one'));
		trackDebridUploaderJob(makeJob('two'));

		updateTrackedDebridUploaderJob('one', { rdAdded: true });

		const jobs = getTrackedDebridUploaderJobs();
		expect(jobs.map((j) => j.id)).toEqual(['two', 'one']);
		expect(jobs[1].rdAdded).toBe(true);
		expect(jobs[1].title).toBe('Job one');
	});

	it('ignores a patch for an unknown job', () => {
		trackDebridUploaderJob(makeJob('one'));
		updateTrackedDebridUploaderJob('nope', { rdAdded: true });
		expect(getTrackedDebridUploaderJobs()).toHaveLength(1);
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
			tbKey: 'tb',
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
			tbKey: 'tb',
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
				tbKey: 'tb',
			})
		).rejects.toThrow('all servers unreachable');
	});
});

describe('runDebridTransferToRd', () => {
	it('polls an in-progress duplicate and adds to RD on completion', async () => {
		vi.useFakeTimers();
		const hash = 'c'.repeat(40);
		const rewrittenHash = 'f'.repeat(40);
		const fetchMock = vi
			.fn()
			// First call: createDebridUploaderJob → in_progress duplicate
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					duplicate: 'in_progress',
					rewrittenHash: null,
					jobId: 'dup-job-1',
				}),
			})
			// Second call: poll → completed with info_hash
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					id: 'dup-job-1',
					status: 'completed',
					info_hash: rewrittenHash,
				}),
			});
		vi.stubGlobal('fetch', fetchMock);

		const promise = runDebridTransferToRd({
			hash,
			imdbId: 'tt1234567',
			rdKey: 'rdkey',
			tbKey: 'tbkey',
			title: 'Test Movie',
			returnPath: '/movie/tt1234567',
		});

		await vi.advanceTimersByTimeAsync(5000);
		const outcome = await promise;

		expect(outcome).toBe('completed');
		const tracked = getTrackedDebridUploaderJobs();
		expect(tracked).toHaveLength(1);
		expect(tracked[0].id).toBe('dup-job-1');
		expect(tracked[0].hash).toBe(hash);
		expect(mockAddHashAsMagnet).toHaveBeenCalledWith('rdkey', rewrittenHash, true);
		expect(mockSelectFiles).toHaveBeenCalledWith('rdkey', 'rd-torrent-id', ['all'], true);
		vi.useRealTimers();
	});

	it('tracks a completed duplicate and returns addedToRd status', async () => {
		const hash = 'd'.repeat(40);
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					duplicate: 'completed',
					rewrittenHash: 'e'.repeat(40),
					jobId: 'dup-job-2',
					addedToRd: true,
				}),
			})
		);

		const outcome = await runDebridTransferToRd({
			hash,
			imdbId: 'tt9999999',
			rdKey: 'rdkey',
			tbKey: 'tbkey',
		});

		expect(outcome).toBe('completed');
		const tracked = getTrackedDebridUploaderJobs();
		expect(tracked).toHaveLength(1);
		expect(tracked[0].id).toBe('dup-job-2');
	});

	it('adds the rewritten hash itself when the server could not', async () => {
		const hash = 'd'.repeat(40);
		const rewrittenHash = 'e'.repeat(40);
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					duplicate: 'completed',
					rewrittenHash,
					jobId: 'dup-job-3',
					addedToRd: false,
				}),
			})
		);

		const outcome = await runDebridTransferToRd({
			hash,
			imdbId: 'tt9999999',
			rdKey: 'rdkey',
			tbKey: 'tbkey',
		});

		expect(outcome).toBe('completed');
		expect(mockAddHashAsMagnet).toHaveBeenCalledWith('rdkey', rewrittenHash, true);
		expect(getTrackedDebridUploaderJobs()[0].rdAdded).toBe(true);
	});

	it('reports a duplicate when RD rejects the fallback add too', async () => {
		mockAddHashAsMagnet.mockRejectedValueOnce(new Error('rd said no'));
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					duplicate: 'completed',
					rewrittenHash: 'e'.repeat(40),
					jobId: 'dup-job-4',
					addedToRd: false,
				}),
			})
		);

		const outcome = await runDebridTransferToRd({
			hash: 'd'.repeat(40),
			imdbId: 'tt9999999',
			rdKey: 'rdkey',
			tbKey: 'tbkey',
		});

		expect(outcome).toBe('duplicate');
		expect(getTrackedDebridUploaderJobs()[0].rdAdded).toBeUndefined();
	});
});

// Clicking X → RD on content whose transfer this browser already tracks used to
// dead-end on an "already transferred" toast: nothing was added to the user's RD,
// which for a transfer started by somebody else meant the content never arrived.
describe('runDebridTransferToRd joining a transfer this browser already tracks', () => {
	const hash = 'a'.repeat(40);
	const rewrittenHash = 'b'.repeat(40);

	const trackJoinable = (patch: Partial<TrackedDebridUploaderJob>) =>
		trackDebridUploaderJob({
			id: 'existing-job',
			hash,
			imdbId: 'tt1234567',
			title: 'Tracked Movie',
			returnPath: '/movie/tt1234567',
			createdAt: 1700000000000,
			...patch,
		});

	const run = () =>
		runDebridTransferToRd({
			hash,
			imdbId: 'tt1234567',
			rdKey: 'rdkey',
			// The row clicked is irrelevant: the transfer is identified by its
			// magnet, so a second click joins the transfer already in flight.
			tbKey: 'tbkey',
		});

	const postedJobs = (fetchMock: ReturnType<typeof vi.fn>) =>
		fetchMock.mock.calls.filter(
			([url, init]: any[]) => url === '/api/debrid-uploader/jobs' && init?.method === 'POST'
		);

	it('adds a finished adopted transfer to RD instead of only saying it exists', async () => {
		trackJoinable({ adopted: true });
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				id: 'existing-job',
				status: 'completed',
				info_hash: rewrittenHash,
			}),
		});
		vi.stubGlobal('fetch', fetchMock);

		expect(await run()).toBe('completed');
		expect(mockAddHashAsMagnet).toHaveBeenCalledWith('rdkey', rewrittenHash, true);
		expect(mockSelectFiles).toHaveBeenCalledWith('rdkey', 'rd-torrent-id', ['all'], true);
		expect(postedJobs(fetchMock)).toHaveLength(0);
		expect(getTrackedDebridUploaderJobs()[0].rdAdded).toBe(true);
	});

	it('waits out an unfinished adopted transfer and adds it on completion', async () => {
		vi.useFakeTimers();
		trackJoinable({ adopted: true });
		const fetchMock = vi
			.fn()
			// the join lookup
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: 'existing-job', status: 'downloading' }),
			})
			// the poll
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					id: 'existing-job',
					status: 'completed',
					info_hash: rewrittenHash,
				}),
			});
		vi.stubGlobal('fetch', fetchMock);

		const promise = run();
		await vi.advanceTimersByTimeAsync(5000);

		expect(await promise).toBe('completed');
		expect(mockAddHashAsMagnet).toHaveBeenCalledWith('rdkey', rewrittenHash, true);
		expect(postedJobs(fetchMock)).toHaveLength(0);
		expect(getTrackedDebridUploaderJobs()).toHaveLength(1);
		vi.useRealTimers();
	});

	it('does not re-add a transfer this browser started itself', async () => {
		// The service was handed this user's RD key when the job was created, so
		// it delivered the torrent already — adding it again just duplicates it.
		trackJoinable({ adopted: false });
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					id: 'existing-job',
					status: 'completed',
					info_hash: rewrittenHash,
				}),
			})
		);

		expect(await run()).toBe('completed');
		expect(mockAddHashAsMagnet).not.toHaveBeenCalled();
	});

	it('does not add twice when a finished transfer was already handed over', async () => {
		trackJoinable({ adopted: true, rdAdded: true });
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					id: 'existing-job',
					status: 'completed',
					info_hash: rewrittenHash,
				}),
			})
		);

		expect(await run()).toBe('completed');
		expect(mockAddHashAsMagnet).not.toHaveBeenCalled();
	});

	it('resubmits when the tracked job failed', async () => {
		trackJoinable({ adopted: true });
		const fetchMock = vi
			.fn()
			// the join lookup finds a dead job
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: 'existing-job', status: 'failed', error: 'boom' }),
			})
			// so a fresh job is created
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: 'new-job', status: 'pending' }),
			});
		vi.stubGlobal('fetch', fetchMock);

		vi.useFakeTimers();
		const promise = run();
		await vi.advanceTimersByTimeAsync(0);
		expect(postedJobs(fetchMock)).toHaveLength(1);
		expect(getTrackedDebridUploaderJobs()[0].id).toBe('new-job');
		expect(getTrackedDebridUploaderJobs()[0].adopted).toBe(false);
		promise.catch(() => undefined);
		vi.useRealTimers();
	});

	it('resubmits when the service no longer knows the tracked job', async () => {
		trackJoinable({ adopted: true });
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: 'new-job', status: 'pending' }),
			});
		vi.stubGlobal('fetch', fetchMock);

		vi.useFakeTimers();
		const promise = run();
		await vi.advanceTimersByTimeAsync(0);
		expect(postedJobs(fetchMock)).toHaveLength(1);
		promise.catch(() => undefined);
		vi.useRealTimers();
	});
});

// Every send flow has to end on the same sentence, because from `uploading` on
// there is nothing left for the browser to say: RD is pulling the bytes and the
// Transfers page has the rest. A joined transfer used to stop short of it — it
// held a spinner (and the row's button) through RD's whole download waiting for
// the hash it still owed this user's RD, and on a slow release ended on a
// "still not handed to RD after 30 min" error for a transfer handed over fine.
describe('runDebridTransferToRd settling once Real-Debrid is pulling', () => {
	const hash = 'a'.repeat(40);
	const rewrittenHash = 'b'.repeat(40);
	const UNDERWAY = 'Send to RD: Real-Debrid download underway — follow it on the Transfers page.';

	const trackJoinable = () =>
		trackDebridUploaderJob({
			id: 'existing-job',
			hash,
			imdbId: 'tt1234567',
			title: 'Tracked Movie',
			createdAt: 1700000000000,
			adopted: true,
		});

	const run = () =>
		runDebridTransferToRd({ hash, imdbId: 'tt1234567', rdKey: 'rdkey', tbKey: 'tbkey' });

	it('settles a joined transfer on the shared toast instead of waiting out RD', async () => {
		vi.useFakeTimers();
		trackJoinable();
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ id: 'existing-job', status: 'uploading' }),
			})
		);

		const promise = run();
		await vi.advanceTimersByTimeAsync(5000);

		expect(await promise).toBe('started');
		// The explicit duration is the point: without one the toast inherits the
		// 30s the loading toast carried, so a finished transfer sits on screen.
		expect(toast.success).toHaveBeenCalledWith(UNDERWAY, {
			id: 'toast-id',
			duration: TRANSFER_TOAST_MS,
		});
		vi.useRealTimers();
	});

	it('settles a transfer this browser started on the same toast', async () => {
		vi.useFakeTimers();
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({ id: 'new-job', status: 'pending' }),
				})
				.mockResolvedValue({
					ok: true,
					json: async () => ({ id: 'new-job', status: 'uploading' }),
				})
		);

		const promise = run();
		await vi.advanceTimersByTimeAsync(5000);

		expect(await promise).toBe('started');
		expect(toast.success).toHaveBeenCalledWith(UNDERWAY, {
			id: 'toast-id',
			duration: TRANSFER_TOAST_MS,
		});
		// The service was handed this user's RD key, so nothing is owed.
		expect(mockAddHashAsMagnet).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	// Letting go of the toast must not let go of the handoff: a joined transfer
	// lands in the RD account that created it, and only the finished job carries
	// the rewritten hash this user's RD needs.
	it('hands a joined transfer over in the background after its toast settles', async () => {
		vi.useFakeTimers();
		trackJoinable();
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({ id: 'existing-job', status: 'downloading' }),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({ id: 'existing-job', status: 'uploading' }),
				})
				.mockResolvedValue({
					ok: true,
					json: async () => ({
						id: 'existing-job',
						status: 'completed',
						info_hash: rewrittenHash,
					}),
				})
		);

		const promise = run();
		await vi.advanceTimersByTimeAsync(5000);
		expect(await promise).toBe('started');
		expect(mockAddHashAsMagnet).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(5000);
		expect(mockAddHashAsMagnet).toHaveBeenCalledWith('rdkey', rewrittenHash, true);
		expect(getTrackedDebridUploaderJobs()[0].rdAdded).toBe(true);
		vi.useRealTimers();
	});
});

describe('toastRdUnderway', () => {
	it('words the end of a transfer the same whatever sourced it', () => {
		toastRdUnderway('TB → RD', 'a');
		toastRdUnderway('AD → RD', 'b');
		toastRdUnderway('Send to RD', 'c');

		expect((toast.success as any).mock.calls.map(([message]: string[]) => message)).toEqual([
			'TB → RD: Real-Debrid download underway — follow it on the Transfers page.',
			'AD → RD: Real-Debrid download underway — follow it on the Transfers page.',
			'Send to RD: Real-Debrid download underway — follow it on the Transfers page.',
		]);
	});
});

describe('needsRdHandoff', () => {
	const base: TrackedDebridUploaderJob = makeJob('one');

	it('is owed for a transfer this browser joined', () => {
		expect(needsRdHandoff({ ...base, adopted: true })).toBe(true);
	});

	it('is not owed for a transfer this browser started', () => {
		expect(needsRdHandoff({ ...base, adopted: false })).toBe(false);
	});

	it('is not owed once it has been paid', () => {
		expect(needsRdHandoff({ ...base, adopted: true, rdAdded: true })).toBe(false);
	});

	// Entries tracked before the flag existed can't be attributed; delivering the
	// content the user asked for beats sparing them a duplicate RD entry.
	it('is owed for an entry with no provenance', () => {
		expect(needsRdHandoff(base)).toBe(true);
	});

	it('is not owed for an untracked job', () => {
		expect(needsRdHandoff(undefined)).toBe(false);
	});
});

// The badge this drives is the only route to a transferred release from the
// search page, and the rewritten hash is the only hash RD will take — marking
// the row without carrying it renders a dead end.
describe('markTransferredHashes', () => {
	const rows = [
		{ hash: 'AAA', tbTransferred: false },
		{ hash: 'bbb', tbTransferred: false },
	];

	const respondWith = (transferred: unknown) => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: true, json: async () => ({ transferred }) })
		);
	};

	it('carries the rewritten hash onto the row it marks', async () => {
		respondWith([{ originalHash: 'aaa', rewrittenHash: 'REWRITTEN' }]);
		let results: any[] = rows;

		await markTransferredHashes(['AAA', 'bbb'], (updater) => {
			results = updater(results);
		});

		expect(results[0]).toMatchObject({
			tbTransferred: true,
			tbTransferredHash: 'rewritten',
		});
		expect(results[1]).toMatchObject({ tbTransferred: false });
		expect(results[1].tbTransferredHash).toBeUndefined();
	});

	it('still marks a row whose mapping carries no rewritten hash', async () => {
		respondWith([{ originalHash: 'aaa' }]);
		let results: any[] = rows;

		await markTransferredHashes(['AAA'], (updater) => {
			results = updater(results);
		});

		expect(results[0]).toMatchObject({ tbTransferred: true });
		expect(results[0].tbTransferredHash).toBeUndefined();
	});
});
