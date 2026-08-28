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
	mockRegister.mockResolvedValue(true);
});

// A `pending` marker used to be permanent: nothing ever wrote a failure, and the
// completion flip only happened if a browser was still polling that job with its
// release id. Both stale states render as a disabled "Running" button for every
// user, so the marker has to be checked against the job it names.
describe('POST /api/nzb2rd/registered — reconciling stale markers', () => {
	it('drops a marker whose job has failed, so the release can be sent again', async () => {
		nzb2rdAnswers({ id: 'job-1', status: 'failed', error: 'RD refused the credentials' });

		const res = await run();

		expect(mockRepo.removeNzb2rdTransfer).toHaveBeenCalledWith('release-1');
		expect(res.json).toHaveBeenCalledWith({ transfers: [] });
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
				{ releaseId: 'release-1', status: 'completed', infoHash: HASH, jobId: 'job-1' },
			],
		});
		expect(mockRepo.removeNzb2rdTransfer).not.toHaveBeenCalled();
	});

	it('leaves a marker alone while its job is genuinely running', async () => {
		nzb2rdAnswers({ id: 'job-1', status: 'fetching' });

		const res = await run();

		expect(mockRepo.removeNzb2rdTransfer).not.toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith({
			transfers: [
				{ releaseId: 'release-1', status: 'pending', infoHash: null, jobId: 'job-1' },
			],
		});
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
				{ releaseId: 'release-1', status: 'pending', infoHash: null, jobId: 'job-1' },
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
				{ releaseId: 'release-1', status: 'completed', infoHash: HASH, jobId: 'job-1' },
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
