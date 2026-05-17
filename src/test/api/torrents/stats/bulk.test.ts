import handler from '@/pages/api/torrents/stats/bulk';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetTrackerStatsByHashes } = vi.hoisted(() => ({
	mockGetTrackerStatsByHashes: vi.fn(),
}));

vi.mock('@/services/database/trackerStats', () => ({
	TrackerStatsService: vi.fn().mockImplementation(() => ({
		getTrackerStatsByHashes: mockGetTrackerStatsByHashes,
	})),
}));

describe('/api/torrents/stats/bulk', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetTrackerStatsByHashes.mockResolvedValue([
			{
				hash: 'a'.repeat(40),
				seeders: 10,
				leechers: 5,
				downloads: 20,
				successfulTrackers: 2,
				totalTrackers: 4,
				lastChecked: new Date('2024-01-01'),
			},
		]);
	});

	it('requires POST method', async () => {
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
	});

	it('validates imdbId parameter', async () => {
		const req = createMockRequest({ method: 'POST', body: { hashes: ['a'.repeat(40)] } });
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({ error: expect.stringContaining('imdbId') })
		);
	});

	it('validates hashes array', async () => {
		const req = createMockRequest({ method: 'POST', body: { imdbId: 'tt1234567' } });
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);

		const req2 = createMockRequest({
			method: 'POST',
			body: { imdbId: 'tt1234567', hashes: [] },
		});
		const res2 = createMockResponse();
		await handler(req2, res2);
		expect(res2.status).toHaveBeenCalledWith(400);

		const req3 = createMockRequest({
			method: 'POST',
			body: { imdbId: 'tt1234567', hashes: new Array(101).fill('a'.repeat(40)) },
		});
		const res3 = createMockResponse();
		await handler(req3, res3);
		expect(res3.status).toHaveBeenCalledWith(400);
	});

	it('validates hash format', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { imdbId: 'tt1234567', hashes: ['invalid'] },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({ error: expect.stringContaining('Invalid hash format') })
		);
	});

	it('returns formatted tracker stats for valid hashes', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { imdbId: 'tt1234567', hashes: ['a'.repeat(40)] },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGetTrackerStatsByHashes).toHaveBeenCalledWith(['a'.repeat(40)]);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith([
			expect.objectContaining({
				hash: 'a'.repeat(40),
				lastChecked: '2024-01-01T00:00:00.000Z',
			}),
		]);
	});

	it('returns 500 on unexpected errors', async () => {
		mockGetTrackerStatsByHashes.mockRejectedValue(new Error('db'));
		const req = createMockRequest({
			method: 'POST',
			body: { imdbId: 'tt1234567', hashes: ['a'.repeat(40)] },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Failed to get bulk tracker stats',
			message: 'db',
		});
	});
});
