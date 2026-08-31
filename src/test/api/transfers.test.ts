import handler from '@/pages/api/transfers';
import { repository } from '@/services/repository';
import { keyOf, listTransfers } from '@/services/transferList';
import {
	registerCompletedDebridJob,
	registerCompletedNzb2rdJob,
} from '@/services/transferRegistration';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/transferList', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/transferList')>();
	return { ...actual, listTransfers: vi.fn() };
});
vi.mock('@/services/transferRegistration', () => ({
	__esModule: true,
	registerCompletedDebridJob: vi.fn().mockResolvedValue(true),
	registerCompletedNzb2rdJob: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/services/debridUploaderServers', () => ({
	__esModule: true,
	resolveJobServer: vi.fn().mockResolvedValue('http://debrid02:3100'),
}));

const mockRepo = vi.mocked(repository);
const mockList = vi.mocked(listTransfers);

const row = (over: Record<string, unknown> = {}) => ({
	source: 'debrid' as const,
	id: 'job-1',
	status: 'uploading',
	createdAt: 1700000000000,
	...over,
});

/** Let the un-awaited registration promises settle before asserting on them. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const bodyOf = (res: ReturnType<typeof createMockResponse>) => (res.json as any).mock.calls[0][0];

const run = async (over: Record<string, any> = {}) => {
	const req = createMockRequest({
		method: 'GET',
		headers: { 'x-rd-api-key': 'rd-key' },
		query: {},
		...over,
	});
	const res = createMockResponse();
	await handler(req as any, res as any);
	return res;
};

beforeEach(() => {
	vi.clearAllMocks();
	mockRepo.getTransferMeta = vi.fn().mockResolvedValue(new Map());
	mockRepo.getDebridJobServer = vi.fn().mockResolvedValue('http://debrid02:3100');
	mockList.mockResolvedValue({ transfers: [row()], raw: new Map(), degraded: [] });
});

describe('GET /api/transfers', () => {
	it('answers with the merged list', async () => {
		const res = await run();

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			transfers: [row()],
			degraded: [],
		});
	});

	it('refuses without a key, and takes it only from the header', async () => {
		// A key in the query string would be written to nginx's logs on every one
		// of these, and this is polled every five seconds per open tab.
		const res = await run({ headers: {}, query: { 'x-rd-api-key': 'rd-key' } });

		expect(res.status).toHaveBeenCalledWith(401);
		expect(mockList).not.toHaveBeenCalled();
	});

	it('rejects a non-GET', async () => {
		const res = await run({ method: 'POST' });
		expect(res.status).toHaveBeenCalledWith(405);
	});

	it('clamps the page bounds', async () => {
		await run({ query: { limit: '999999', offset: '-3' } });
		expect(mockList).toHaveBeenCalledWith('rd-key', 200, 0);

		mockList.mockClear();
		await run({ query: { limit: '', offset: '' } });
		// `Number('')` is 0, so an empty param must fall back rather than clamp to
		// the minimum and return a single row.
		expect(mockList).toHaveBeenCalledWith('rd-key', 100, 0);
	});

	it('passes the services through when one is unreachable', async () => {
		mockList.mockResolvedValue({ transfers: [], raw: new Map(), degraded: ['nzb2rd'] });

		const res = await run();

		expect(res.json).toHaveBeenCalledWith({ transfers: [], degraded: ['nzb2rd'] });
	});

	it('overlays the stored page context onto the rows', async () => {
		mockRepo.getTransferMeta = vi.fn().mockResolvedValue(
			new Map([
				[
					'debrid:job-1',
					{
						source: 'debrid',
						jobId: 'job-1',
						title: 'Nice',
						returnPath: '/movie/tt1',
					},
				],
			])
		);

		const res = await run();

		expect(bodyOf(res).transfers[0]).toMatchObject({
			title: 'Nice',
			returnPath: '/movie/tt1',
		});
	});

	it('still serves the list when the context lookup fails', async () => {
		// Losing a title is a cosmetic degradation; losing the list is not.
		mockRepo.getTransferMeta = vi.fn().mockRejectedValue(new Error('db down'));

		const res = await run();

		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('answers 502 when the fan-out itself throws', async () => {
		mockList.mockRejectedValue(new Error('boom'));

		const res = await run();

		expect(res.status).toHaveBeenCalledWith(502);
	});
});

describe('registration from the list poll', () => {
	it('files a completed transfer that has stored page context', async () => {
		// This is what makes one user's transfer searchable for everyone. It used
		// to run off the per-job poll the list replaced, so it had to move here.
		mockList.mockResolvedValue({
			transfers: [row({ status: 'completed' })],
			raw: new Map([['debrid:job-1', { id: 'job-1', info_hash: 'a'.repeat(40) }]]),
			degraded: [],
		});
		mockRepo.getTransferMeta = vi
			.fn()
			.mockResolvedValue(
				new Map([
					[
						'debrid:job-1',
						{ source: 'debrid', jobId: 'job-1', returnPath: '/movie/tt1' },
					],
				])
			);

		await run();
		await flush();

		expect(registerCompletedDebridJob).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'job-1' }),
			'movie',
			undefined,
			'http://debrid02:3100'
		);
	});

	it('routes an nzb2rd row to its own registration, with the release id', async () => {
		mockList.mockResolvedValue({
			transfers: [row({ source: 'nzb2rd', id: 'n1', status: 'completed' })],
			raw: new Map([['nzb2rd:n1', { id: 'n1' }]]),
			degraded: [],
		});
		mockRepo.getTransferMeta = vi.fn().mockResolvedValue(
			new Map([
				[
					'nzb2rd:n1',
					{
						source: 'nzb2rd',
						jobId: 'n1',
						returnPath: '/show/tt1234567/2',
						releaseId: 'ds:abc',
					},
				],
			])
		);

		await run();
		await flush();

		expect(registerCompletedNzb2rdJob).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'n1' }),
			'tv',
			2,
			'ds:abc'
		);
	});

	it('skips a row with no stored context rather than filing it under a guess', async () => {
		// An *arr job, or one submitted before DMM recorded context. `imdb_id`
		// alone cannot stand in: nothing in it says film or season of a show.
		mockList.mockResolvedValue({
			transfers: [row({ status: 'completed' })],
			raw: new Map([['debrid:job-1', { id: 'job-1' }]]),
			degraded: [],
		});

		await run();
		await flush();

		expect(registerCompletedDebridJob).not.toHaveBeenCalled();
	});

	it('does not touch a transfer that has not completed', async () => {
		mockRepo.getTransferMeta = vi
			.fn()
			.mockResolvedValue(
				new Map([
					[
						'debrid:job-1',
						{ source: 'debrid', jobId: 'job-1', returnPath: '/movie/tt1' },
					],
				])
			);

		await run();
		await flush();

		expect(registerCompletedDebridJob).not.toHaveBeenCalled();
	});

	it('answers the list even when a registration throws', async () => {
		// It runs for everyone else's benefit, so it must never fail the request
		// this user is waiting on.
		vi.mocked(registerCompletedDebridJob).mockRejectedValue(new Error('db down'));
		mockList.mockResolvedValue({
			transfers: [row({ status: 'completed' })],
			raw: new Map([['debrid:job-1', { id: 'job-1' }]]),
			degraded: [],
		});
		mockRepo.getTransferMeta = vi
			.fn()
			.mockResolvedValue(
				new Map([
					[
						'debrid:job-1',
						{ source: 'debrid', jobId: 'job-1', returnPath: '/movie/tt1' },
					],
				])
			);

		const res = await run();
		await flush();

		expect(res.status).toHaveBeenCalledWith(200);
	});
});

// The `nzbrd:<releaseId>` marker is what the Usenet section reads to decide a
// release is already being fetched. It only ever moved pending → completed, so
// a failed job left it saying "someone is fetching this" forever — and because
// it is keyed on the shared indexer release id, one person's failure showed a
// disabled "Running" button to everyone. This poll is the one place that sees a
// job go terminal on its owner's behalf.
describe('GET /api/transfers — keeping the nzb2rd release markers truthful', () => {
	const nzbRow = (over: Record<string, unknown> = {}) => ({
		source: 'nzb2rd' as const,
		id: 'job-9',
		status: 'failed',
		releaseId: 'release-9',
		createdAt: 1700000000000,
		...over,
	});

	beforeEach(() => {
		mockRepo.removeNzb2rdTransfer = vi.fn().mockResolvedValue(undefined);
		mockRepo.recordNzb2rdTransferFailed = vi.fn().mockResolvedValue(undefined);
	});

	// Recorded rather than deleted: deleting unblocked the resubmit but left the
	// row saying nothing about the attempt that had already failed. The marker
	// now carries the reason so the Usenet row can offer an informed Retry, and
	// it still blocks nothing — the dedup check re-reads the job either way.
	it('records the failure of a Usenet job, with the reason and the release it belongs to', async () => {
		mockList.mockResolvedValue({
			transfers: [
				nzbRow({ error: 'par2 exited 2', imdbId: 'tt1308738', title: 'A.Release' }),
			],
			raw: new Map(),
			degraded: [],
		});

		await run();
		await flush();

		expect(mockRepo.recordNzb2rdTransferFailed).toHaveBeenCalledWith(
			'release-9',
			'job-9',
			'tt1308738',
			'par2 exited 2',
			'A.Release'
		);
		expect(mockRepo.removeNzb2rdTransfer).not.toHaveBeenCalled();
	});

	it('leaves the marker of a running Usenet job alone', async () => {
		mockList.mockResolvedValue({
			transfers: [nzbRow({ status: 'fetching' })],
			raw: new Map(),
			degraded: [],
		});

		await run();
		await flush();

		expect(mockRepo.removeNzb2rdTransfer).not.toHaveBeenCalled();
	});

	it('has no marker to clear for a failed debrid-uploader job', async () => {
		mockList.mockResolvedValue({
			transfers: [row({ status: 'failed' })],
			raw: new Map(),
			degraded: [],
		});

		await run();
		await flush();

		expect(mockRepo.removeNzb2rdTransfer).not.toHaveBeenCalled();
	});

	// Recording the marker and serving the waiting accounts need no page context;
	// only filing into the search index does. Gating all three on `returnPath` is
	// why 905 completed jobs still showed as "Running".
	it('records a completed Usenet job even when the row carries no return path', async () => {
		const completed = nzbRow({ status: 'completed', returnPath: undefined });
		const job = { id: 'job-9', status: 'completed', info_hash: 'a'.repeat(40) };
		mockList.mockResolvedValue({
			transfers: [completed],
			raw: new Map([[keyOf(completed as any), job]]),
			degraded: [],
		});

		await run();
		await flush();

		expect(registerCompletedNzb2rdJob).toHaveBeenCalledWith(
			job,
			undefined,
			undefined,
			'release-9'
		);
	});
});
