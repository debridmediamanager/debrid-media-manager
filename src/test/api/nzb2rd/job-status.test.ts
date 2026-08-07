import handler from '@/pages/api/nzb2rd/jobs/[id]';
import { addHashToRdAccount } from '@/services/nzb2rd';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/nzb2rd', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/nzb2rd')>();
	return { ...actual, addHashToRdAccount: vi.fn() };
});

const mockRepo = vi.mocked(repository);
const mockAddToRd = vi.mocked(addHashToRdAccount);

const HASH = 'b'.repeat(40);

const completedJob = {
	id: 'job-A',
	status: 'completed',
	info_hash: HASH,
	imdb_id: 'tt1418646',
	name: 'Some.Release.1080p',
	completed_at: '2026-08-07 12:00:00',
	files: [{ name: 'movie.mkv', size: 100, rd_link: 'https://real-debrid.com/d/X' }],
};

const run = async (query: Record<string, string>, job: any = completedJob) => {
	global.fetch = vi.fn().mockResolvedValue({
		ok: true,
		status: 200,
		json: async () => ({ ...job }),
	}) as any;
	const req = createMockRequest({ method: 'GET', query: { id: 'job-A', ...query } });
	const res = createMockResponse();
	await handler(req as any, res as any);
	return res;
};

beforeEach(() => {
	vi.clearAllMocks();
	mockRepo.recordNzb2rdTransferCompleted = vi.fn().mockResolvedValue(undefined);
	mockRepo.takeNzb2rdWaiters = vi.fn().mockResolvedValue([]);
	mockRepo.checkAvailabilityByHashes = vi.fn().mockResolvedValue([]);
	mockRepo.saveScrapedTrueResults = vi.fn().mockResolvedValue(undefined);
	mockRepo.upsertAvailability = vi.fn().mockResolvedValue(undefined);
	mockAddToRd.mockResolvedValue('rd-torrent-1');
});

describe('GET /api/nzb2rd/jobs/[id] — delivering a finished transfer', () => {
	it('adds the finished torrent to every account that was waiting on it', async () => {
		mockRepo.takeNzb2rdWaiters = vi.fn().mockResolvedValue([
			{ rdKey: 'rd-key-b', imdbId: 'tt1418646', queuedAt: 1 },
			{ rdKey: 'rd-key-c', imdbId: 'tt1418646', queuedAt: 2 },
		]);

		await run({ mediaType: 'movie', releaseId: 'release-1' });

		expect(mockAddToRd).toHaveBeenCalledTimes(2);
		expect(mockAddToRd).toHaveBeenCalledWith('rd-key-b', HASH);
		expect(mockAddToRd).toHaveBeenCalledWith('rd-key-c', HASH);
	});

	it('takes the waiters, so a second poll cannot add the same torrent twice', async () => {
		mockRepo.takeNzb2rdWaiters = vi
			.fn()
			.mockResolvedValueOnce([{ rdKey: 'rd-key-b', imdbId: 'tt1418646', queuedAt: 1 }])
			.mockResolvedValueOnce([]);

		await run({ mediaType: 'movie', releaseId: 'release-1' });
		await run({ mediaType: 'movie', releaseId: 'release-1' });

		expect(mockAddToRd).toHaveBeenCalledTimes(1);
	});

	it('keeps going when one account fails', async () => {
		mockRepo.takeNzb2rdWaiters = vi.fn().mockResolvedValue([
			{ rdKey: 'bad-key', imdbId: 'tt1418646', queuedAt: 1 },
			{ rdKey: 'good-key', imdbId: 'tt1418646', queuedAt: 2 },
		]);
		mockAddToRd.mockRejectedValueOnce(new Error('RD 401')).mockResolvedValueOnce('ok');

		const res = await run({ mediaType: 'movie', releaseId: 'release-1' });

		expect(mockAddToRd).toHaveBeenCalledTimes(2);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	// Delivery must not depend on the page context that drives the searchable row.
	it('delivers even with no movie/tv context to register the row under', async () => {
		mockRepo.takeNzb2rdWaiters = vi
			.fn()
			.mockResolvedValue([{ rdKey: 'rd-key-b', imdbId: 'tt1418646', queuedAt: 1 }]);

		await run({ releaseId: 'release-1' });

		expect(mockAddToRd).toHaveBeenCalledWith('rd-key-b', HASH);
		expect(mockRepo.saveScrapedTrueResults).not.toHaveBeenCalled();
	});

	it('does nothing for a job that has not finished', async () => {
		await run(
			{ mediaType: 'movie', releaseId: 'release-1' },
			{ ...completedJob, status: 'fetching' }
		);

		expect(mockRepo.takeNzb2rdWaiters).not.toHaveBeenCalled();
		expect(mockAddToRd).not.toHaveBeenCalled();
	});

	it('still registers the torrent when nobody was waiting', async () => {
		await run({ mediaType: 'movie', releaseId: 'release-1' });

		expect(mockAddToRd).not.toHaveBeenCalled();
		expect(mockRepo.upsertAvailability).toHaveBeenCalled();
	});
});
