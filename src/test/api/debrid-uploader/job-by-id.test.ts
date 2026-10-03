import handler from '@/pages/api/debrid-uploader/jobs/[id]';
import { repository } from '@/services/repository';
import { registerCompletedDebridJob } from '@/services/transferRegistration';
import cancelledPending from '@/test/fixtures/debridUploader/job-cancelled-pending.json';
import cancelledUploading from '@/test/fixtures/debridUploader/job-cancelled-uploading.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/transferRegistration', () => ({
	registerCompletedDebridJob: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/services/debridUploaderServers', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/debridUploaderServers')>()),
	resolveJobServer: vi.fn(async () => 'http://uploader:3100'),
}));

const get = async (body: unknown) => {
	global.fetch = vi.fn().mockResolvedValue({
		ok: true,
		status: 200,
		json: async () => ({ ...(body as object) }),
	}) as any;
	const req = createMockRequest({ method: 'GET', query: { id: (body as { id: string }).id } });
	const res = createMockResponse();
	await handler(req as any, res as any);
	return res;
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(repository).getDebridJobServer = vi.fn().mockResolvedValue(null);
});

// What the browser reads for a job it tracks, both when a send decides whether
// to join an existing transfer and while it polls one. Card 109's screenshot is
// the join: "TB → RD: transfer already in progress — waiting for completion...",
// for a job its submitter had cancelled, which waited 30 minutes and gave up,
// on every click. Bodies are the uploader's for two such jobs, 2026-10-03.
describe('GET /api/debrid-uploader/jobs/[id] for a cancelled job', () => {
	it.each([
		['while RD was pulling', cancelledUploading],
		['while queued', cancelledPending],
	])('answers failed for a job cancelled %s', async (_label, job) => {
		const res = await get(job);

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toMatchObject({
			id: job.id,
			status: 'failed',
			error: 'cancelled',
		});
		expect(registerCompletedDebridJob).not.toHaveBeenCalled();
	});

	it('passes a running job through untouched', async () => {
		const res = await get({ ...cancelledUploading, deleted: 0 });

		expect(res._getData()).toMatchObject({ status: 'uploading', error: null });
	});

	it('passes the uploader answer to a cancel through untouched', async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ok: true }),
		}) as any;
		const req = createMockRequest({ method: 'DELETE', query: { id: cancelledUploading.id } });
		const res = createMockResponse();
		await handler(req as any, res as any);

		expect(res._getData()).toEqual({ ok: true });
	});
});
