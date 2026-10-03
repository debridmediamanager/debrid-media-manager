import cancelledUploading from '@/test/fixtures/debridUploader/job-cancelled-uploading.json';
import { describe, expect, it } from 'vitest';
import { CANCELLED_JOB_ERROR, settleCancelledDebridJob } from './debridJobOutcome';

describe('settleCancelledDebridJob', () => {
	it('reads a job cancelled mid-pipeline as failed', () => {
		expect(settleCancelledDebridJob(cancelledUploading)).toMatchObject({
			id: cancelledUploading.id,
			status: 'failed',
			error: CANCELLED_JOB_ERROR,
			status_message: cancelledUploading.status_message,
		});
	});

	it('keeps the real outcome of a job that finished before its cancel', () => {
		const completed = { ...cancelledUploading, status: 'completed' };
		const failed = { ...cancelledUploading, status: 'failed', error: 'uncached' };

		expect(settleCancelledDebridJob(completed)).toBe(completed);
		expect(settleCancelledDebridJob(failed)).toBe(failed);
	});

	it('leaves a live job and anything that is not a job alone', () => {
		const live = { ...cancelledUploading, deleted: 0 };

		expect(settleCancelledDebridJob(live)).toBe(live);
		expect(settleCancelledDebridJob(null)).toBeNull();
		expect(settleCancelledDebridJob({ error: 'not found' })).toEqual({ error: 'not found' });
	});
});
