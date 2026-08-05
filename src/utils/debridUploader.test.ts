import { beforeEach, describe, expect, it } from 'vitest';
import {
	getTrackedDebridUploaderJobs,
	isTerminalDebridUploaderStatus,
	trackDebridUploaderJob,
	TrackedDebridUploaderJob,
	untrackDebridUploaderJob,
} from './debridUploader';

const makeJob = (id: string): TrackedDebridUploaderJob => ({
	id,
	hash: 'a'.repeat(40),
	imdbId: 'tt1234567',
	title: `Job ${id}`,
	returnPath: '/movie/tt1234567',
	createdAt: 1700000000000,
});

describe('debridUploader job tracking', () => {
	beforeEach(() => {
		localStorage.clear();
	});

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
