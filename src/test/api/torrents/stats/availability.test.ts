import handler from '@/pages/api/torrents/stats/availability';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetTrackerStatsByHashes = vi.fn();

vi.mock('@/services/database/trackerStats', () => ({
	TrackerStatsService: vi.fn().mockImplementation(function () {
		return { getTrackerStatsByHashes: mockGetTrackerStatsByHashes };
	}),
}));

const validHashA = 'a'.repeat(40);
const validHashB = 'b'.repeat(40);
const validHashC = 'c'.repeat(40);

describe('/api/torrents/stats/availability', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetTrackerStatsByHashes.mockReset();
	});

	it('accepts only POST requests', async () => {
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
	});

	it('validates hashes payload', async () => {
		const res = createMockResponse();
		await handler(createMockRequest({ method: 'POST', body: { hashes: null } }), res);
		expect(res.status).toHaveBeenCalledWith(400);

		const res2 = createMockResponse();
		await handler(createMockRequest({ method: 'POST', body: { hashes: [] } }), res2);
		expect(res2.status).toHaveBeenCalledWith(400);

		const res3 = createMockResponse();
		await handler(
			createMockRequest({
				method: 'POST',
				body: { hashes: Array.from({ length: 101 }).fill(validHashA) },
			}),
			res3
		);
		expect(res3.status).toHaveBeenCalledWith(400);
	});

	it('rejects invalid hashes and maxAgeHours', async () => {
		const res = createMockResponse();
		await handler(
			createMockRequest({
				method: 'POST',
				body: { hashes: ['bad-hash'], maxAgeHours: -1 },
			}),
			res
		);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('categorizes hashes into available, stale, and missing', async () => {
		const now = new Date();
		const freshStat = {
			hash: validHashA,
			seeders: 10,
			leechers: 2,
			downloads: 5,
			successfulTrackers: 3,
			totalTrackers: 5,
			lastChecked: now,
		};
		const staleStat = {
			hash: validHashB,
			seeders: 0,
			leechers: 0,
			downloads: 0,
			successfulTrackers: 1,
			totalTrackers: 5,
			lastChecked: new Date(now.getTime() - 48 * 60 * 60 * 1000),
		};
		mockGetTrackerStatsByHashes.mockResolvedValue([freshStat, staleStat]);

		const req = createMockRequest({
			method: 'POST',
			body: { hashes: [validHashA, validHashB, validHashC], maxAgeHours: 24 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		const payload = (res.json as Mock).mock.calls[0][0] as {
			available: Array<{ hash: string; isStale: boolean }>;
			missing: string[];
			stale: string[];
			summary: { total: number; available: number; missing: number; stale: number };
		};
		expect(payload.available).toEqual([
			expect.objectContaining({ hash: validHashA, isStale: false }),
			expect.objectContaining({ hash: validHashB, isStale: true }),
		]);
		expect(payload.missing).toEqual([validHashC]);
		expect(payload.summary).toEqual({ total: 3, available: 2, missing: 1, stale: 1 });
	});

	it('handles tracker service failures', async () => {
		mockGetTrackerStatsByHashes.mockRejectedValue(new Error('db down'));
		const req = createMockRequest({
			method: 'POST',
			body: { hashes: [validHashA] },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Failed to check tracker stats availability',
			message: 'db down',
		});
	});
});
