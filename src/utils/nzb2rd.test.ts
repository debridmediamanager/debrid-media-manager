import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createNzb2rdJob,
	deleteNzb2rdJob,
	fetchNzb2rdTransfers,
	getNzb2rdJob,
	getTrackedNzb2rdJobs,
	isNzb2rdDuplicate,
	isTerminalNzb2rdStatus,
	TrackedNzb2rdJob,
	trackNzb2rdJob,
	untrackNzb2rdJob,
} from './nzb2rd';

const makeJob = (id: string): TrackedNzb2rdJob => ({
	id,
	releaseId: `release-${id}`,
	imdbId: 'tt1418646',
	title: `Job ${id}`,
	returnPath: '/movie/tt1418646',
	createdAt: 1700000000000,
});

beforeEach(() => {
	localStorage.clear();
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('nzb2rd job tracking', () => {
	it('returns an empty list when nothing is tracked', () => {
		expect(getTrackedNzb2rdJobs()).toEqual([]);
	});

	it('tracks newest-first, dedupes by id, and untracks', () => {
		trackNzb2rdJob(makeJob('one'));
		trackNzb2rdJob(makeJob('two'));
		trackNzb2rdJob({ ...makeJob('one'), title: 'renamed' });

		const jobs = getTrackedNzb2rdJobs();
		expect(jobs.map((j) => j.id)).toEqual(['one', 'two']);
		expect(jobs[0].title).toBe('renamed');

		untrackNzb2rdJob('one');
		expect(getTrackedNzb2rdJobs().map((j) => j.id)).toEqual(['two']);
	});

	it('survives corrupt storage instead of throwing', () => {
		localStorage.setItem('nzb2rd:jobs', 'not json');
		expect(getTrackedNzb2rdJobs()).toEqual([]);
	});

	it('keeps its own key, separate from TB → RD transfers', () => {
		trackNzb2rdJob(makeJob('one'));
		expect(localStorage.getItem('nzb2rd:jobs')).toBeTruthy();
		expect(localStorage.getItem('debridUploader:jobs')).toBeNull();
	});
});

describe('isTerminalNzb2rdStatus', () => {
	it('treats only completed and failed as terminal', () => {
		expect(isTerminalNzb2rdStatus('completed')).toBe(true);
		expect(isTerminalNzb2rdStatus('failed')).toBe(true);
		// nzb2rd has stages the TB → RD flow never reports
		expect(isTerminalNzb2rdStatus('probing')).toBe(false);
		expect(isTerminalNzb2rdStatus('fetching')).toBe(false);
		expect(isTerminalNzb2rdStatus('unpacking')).toBe(false);
		expect(isTerminalNzb2rdStatus('hashing')).toBe(false);
	});
});

describe('createNzb2rdJob', () => {
	it('posts the release and returns the job', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ id: 'job-1', status: 'pending' }),
		});
		vi.stubGlobal('fetch', fetchMock);

		const job = await createNzb2rdJob({
			id: 'rel-1',
			title: 'A',
			imdbId: 'tt1418646',
			rdKey: 'k',
		});

		expect(isNzb2rdDuplicate(job)).toBe(false);
		expect(fetchMock).toHaveBeenCalledWith('/api/nzb2rd/jobs', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: 'rel-1', title: 'A', imdbId: 'tt1418646', rdKey: 'k' }),
		});
	});

	it('recognises a duplicate response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ duplicate: 'completed', infoHash: 'a', jobId: 'j' }),
			})
		);
		const job = await createNzb2rdJob({
			id: 'rel-1',
			title: 'A',
			imdbId: 'tt1418646',
			rdKey: 'k',
		});
		expect(isNzb2rdDuplicate(job)).toBe(true);
	});

	it('surfaces the server error message', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 502,
				json: async () => ({ error: 'nzb2rd service unreachable' }),
			})
		);
		await expect(
			createNzb2rdJob({ id: 'r', title: 'A', imdbId: 'tt1418646', rdKey: 'k' })
		).rejects.toThrow('nzb2rd service unreachable');
	});
});

describe('getNzb2rdJob', () => {
	it('carries page context and release id so the poll can register the result', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue({ ok: true, json: async () => ({ id: 'j', status: 'completed' }) });
		vi.stubGlobal('fetch', fetchMock);

		await getNzb2rdJob('job-1', { mediaType: 'tv', seasonNum: 2 }, 'rel-1');

		const url = fetchMock.mock.calls[0][0];
		expect(url).toBe('/api/nzb2rd/jobs/job-1?mediaType=tv&seasonNum=2&releaseId=rel-1');
	});

	it('sends no query when there is nothing to say', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue({ ok: true, json: async () => ({ id: 'j', status: 'pending' }) });
		vi.stubGlobal('fetch', fetchMock);

		await getNzb2rdJob('job-1');
		expect(fetchMock.mock.calls[0][0]).toBe('/api/nzb2rd/jobs/job-1');
	});
});

describe('deleteNzb2rdJob', () => {
	it('passes the release id so the cancel clears the dedup record', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
		vi.stubGlobal('fetch', fetchMock);

		await deleteNzb2rdJob('job-1', 'rel-1');

		expect(fetchMock).toHaveBeenCalledWith('/api/nzb2rd/jobs/job-1?releaseId=rel-1', {
			method: 'DELETE',
		});
	});
});

describe('fetchNzb2rdTransfers', () => {
	it('returns the recorded transfers', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					transfers: [{ releaseId: 'a', status: 'completed', infoHash: 'h', jobId: 'j' }],
				}),
			})
		);
		expect(await fetchNzb2rdTransfers(['a'])).toHaveLength(1);
	});

	it('is best-effort: a failed lookup yields no markers rather than throwing', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
		expect(await fetchNzb2rdTransfers(['a'])).toEqual([]);
	});

	it('skips the request entirely for an empty list', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		expect(await fetchNzb2rdTransfers([])).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
