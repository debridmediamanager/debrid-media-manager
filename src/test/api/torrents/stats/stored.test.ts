import handler from '@/pages/api/torrents/stats/stored';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetTrackerStats } = vi.hoisted(() => ({
	mockGetTrackerStats: vi.fn(),
}));

vi.mock('@/services/database/trackerStats', () => ({
	TrackerStatsService: vi.fn().mockImplementation(function () {
		return { getTrackerStats: mockGetTrackerStats };
	}),
}));

describe('/api/torrents/stats/stored', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetTrackerStats.mockResolvedValue({
			hash: 'a'.repeat(40),
			seeders: 1,
			leechers: 2,
			downloads: 3,
			successfulTrackers: 1,
			totalTrackers: 2,
			lastChecked: new Date('2024-01-01'),
		});
	});

	it('enforces GET', async () => {
		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
	});

	it('validates hash parameter', async () => {
		const req = createMockRequest({ method: 'GET', query: {} });
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);

		const req2 = createMockRequest({ method: 'GET', query: { hash: 'bad' } });
		const res2 = createMockResponse();
		await handler(req2, res2);
		expect(res2.status).toHaveBeenCalledWith(400);
	});

	it('returns stored stats when available', async () => {
		const req = createMockRequest({ method: 'GET', query: { hash: 'a'.repeat(40) } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			hash: 'a'.repeat(40),
			seeders: 1,
			leechers: 2,
			downloads: 3,
			successfulTrackers: 1,
			totalTrackers: 2,
			lastChecked: '2024-01-01T00:00:00.000Z',
		});
	});

	it('handles missing stats gracefully', async () => {
		mockGetTrackerStats.mockResolvedValue(null);
		const req = createMockRequest({ method: 'GET', query: { hash: 'a'.repeat(40) } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(404);
		expect(res.json).toHaveBeenCalledWith({
			error: 'No tracker stats found for this hash',
		});
	});

	it('maps table-not-found errors to 404', async () => {
		mockGetTrackerStats.mockRejectedValue({ message: 'does not exist' });
		const req = createMockRequest({ method: 'GET', query: { hash: 'a'.repeat(40) } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(404);
	});

	it('returns 500 on other errors', async () => {
		mockGetTrackerStats.mockRejectedValue(new Error('db'));
		const req = createMockRequest({ method: 'GET', query: { hash: 'a'.repeat(40) } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Failed to get stored tracker stats',
			message: 'db',
		});
	});
});
