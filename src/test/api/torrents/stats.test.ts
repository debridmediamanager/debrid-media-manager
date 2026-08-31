import handler from '@/pages/api/torrents/stats';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { mintProblemToken } from '@/utils/problemToken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockScrapeTorrent, mockUpsertTrackerStats } = vi.hoisted(() => ({
	mockScrapeTorrent: vi.fn(),
	mockUpsertTrackerStats: vi.fn(),
}));

vi.mock('@/utils/torrentScraper', () => ({
	torrentScraper: {
		scrapeTorrent: mockScrapeTorrent,
	},
}));

vi.mock('@/services/database/trackerStats', () => ({
	TrackerStatsService: vi.fn().mockImplementation(() => ({
		upsertTrackerStats: mockUpsertTrackerStats,
	})),
}));

const SECRET = 'test-problem-secret-0123456789';

/** The credentials a browser would carry, in the query shape this route reads. */
function authQuery() {
	const [dmmProblemKey, solution] = mintProblemToken(SECRET);
	return { dmmProblemKey, solution };
}

describe('/api/torrents/stats', () => {
	const originalEnv = process.env;

	afterEach(() => {
		process.env = originalEnv;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		process.env = {
			...originalEnv,
			DMM_PROBLEM_SECRET: SECRET,
		};
		mockScrapeTorrent.mockResolvedValue({
			seeders: 10,
			leechers: 5,
			downloads: 20,
			successfulTrackers: 2,
			totalTrackers: 4,
		});
	});

	it('enforces GET requests', async () => {
		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
	});

	it('validates hash parameter presence and format', async () => {
		const req = createMockRequest({ method: 'GET', query: { ...authQuery() } });
		const res = createMockResponse();

		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);

		const req2 = createMockRequest({ method: 'GET', query: { ...authQuery(), hash: '12345' } });
		const res2 = createMockResponse();
		await handler(req2, res2);
		expect(res2.status).toHaveBeenCalledWith(400);
	});

	it('scrapes stats and stores them, returning formatted response', async () => {
		const req = createMockRequest({
			method: 'GET',
			query: { ...authQuery(), hash: 'a'.repeat(40) },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockScrapeTorrent).toHaveBeenCalledWith('a'.repeat(40));
		expect(mockUpsertTrackerStats).toHaveBeenCalledWith(
			expect.objectContaining({ hash: 'a'.repeat(40) })
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			hash: 'a'.repeat(40),
			seeders: 10,
			leechers: 5,
			downloads: 20,
			trackers: { successful: 2, total: 4 },
		});
	});

	it('still responds when database persistence fails', async () => {
		mockUpsertTrackerStats.mockRejectedValue(new Error('db'));
		const req = createMockRequest({
			method: 'GET',
			query: { ...authQuery(), hash: 'b'.repeat(40) },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('returns 500 when scraping fails', async () => {
		mockScrapeTorrent.mockRejectedValue(new Error('network'));
		const req = createMockRequest({
			method: 'GET',
			query: { ...authQuery(), hash: 'c'.repeat(40) },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Failed to get torrent stats',
			message: 'network',
		});
	});

	// This route was reachable with a bare curl for its whole life: the auth block
	// shipped commented out in 1bf984d4 and was never enabled. It matters because
	// one call fans out to every tracker in the list (109 of them when measured)
	// as parallel outbound connections — so an open route is a ~109x amplifier
	// aimed at this server. The assertion that matters is not the status code but
	// that no scrape is attempted.
	it('refuses an unauthenticated caller without scraping a single tracker', async () => {
		const req = createMockRequest({ method: 'GET', query: { hash: 'a'.repeat(40) } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ errorMessage: 'Authentication not provided' });
		expect(mockScrapeTorrent).not.toHaveBeenCalled();
		expect(mockUpsertTrackerStats).not.toHaveBeenCalled();
	});

	it('refuses a forged token without scraping', async () => {
		const req = createMockRequest({
			method: 'GET',
			query: {
				hash: 'a'.repeat(40),
				dmmProblemKey: `deadbeef-${Math.floor(Date.now() / 1000)}`,
				solution: 'not-a-real-signature',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ errorMessage: 'Authentication error' });
		expect(mockScrapeTorrent).not.toHaveBeenCalled();
	});

	it('refuses a token signed with a key the server does not hold', async () => {
		const [dmmProblemKey, solution] = mintProblemToken('a-different-secret');
		const req = createMockRequest({
			method: 'GET',
			query: { hash: 'a'.repeat(40), dmmProblemKey, solution },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(mockScrapeTorrent).not.toHaveBeenCalled();
	});
});
