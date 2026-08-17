import handler from '@/pages/api/nzb2rd/jobs/[id]';
import { addHashToRdAccount } from '@/services/nzb2rd';
import { getToken } from '@/services/realDebrid';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/nzb2rd', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/nzb2rd')>();
	return { ...actual, addHashToRdAccount: vi.fn() };
});
vi.mock('@/services/realDebrid', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/realDebrid')>();
	return { ...actual, getToken: vi.fn() };
});

const mockRepo = vi.mocked(repository);
const mockAddToRd = vi.mocked(addHashToRdAccount);
const mockGetToken = vi.mocked(getToken);

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

	// A waiter's stored rdKey is an OAuth access token RD expires 24h after
	// login, and this list is only drained when the job completes — days later.
	// Delivering with the stored token therefore failed silently (the catch just
	// logs), so the user waited and received nothing.
	it('mints a fresh token before delivering to a waiter that supplied credentials', async () => {
		mockGetToken.mockResolvedValue({ access_token: 'FRESH_TOKEN' } as never);
		mockRepo.takeNzb2rdWaiters = vi.fn().mockResolvedValue([
			{
				rdKey: 'expired-token',
				oauth: { clientId: 'CID', clientSecret: 'CSEC', refreshToken: 'CREF' },
				imdbId: 'tt1418646',
				queuedAt: 1,
			},
		]);

		await run({ mediaType: 'movie', releaseId: 'release-1' });

		expect(mockGetToken).toHaveBeenCalledWith('CID', 'CSEC', 'CREF', true);
		expect(mockAddToRd).toHaveBeenCalledWith('FRESH_TOKEN', HASH);
		expect(mockAddToRd).not.toHaveBeenCalledWith('expired-token', HASH);
	});

	// Entries queued before the credentials were recorded must keep working
	// exactly as well as they did, and a refresh failure must not deny a
	// delivery that the stored token might still manage.
	it('falls back to the stored token when there is nothing to mint from', async () => {
		mockGetToken.mockRejectedValue(new Error('revoked'));
		mockRepo.takeNzb2rdWaiters = vi.fn().mockResolvedValue([
			{ rdKey: 'legacy-token', imdbId: 'tt1418646', queuedAt: 1 },
			{
				rdKey: 'stored-token',
				oauth: { clientId: 'CID', clientSecret: 'CSEC', refreshToken: 'CREF' },
				imdbId: 'tt1418646',
				queuedAt: 2,
			},
		]);

		await run({ mediaType: 'movie', releaseId: 'release-1' });

		// No credentials at all: never asks RD for a token.
		expect(mockGetToken).toHaveBeenCalledTimes(1);
		expect(mockAddToRd).toHaveBeenCalledWith('legacy-token', HASH);
		expect(mockAddToRd).toHaveBeenCalledWith('stored-token', HASH);
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
