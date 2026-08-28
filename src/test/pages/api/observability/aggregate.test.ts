import type { NextApiRequest, NextApiResponse } from 'next';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import handler from '@/pages/api/observability/aggregate';

// Mock the repository
vi.mock('@/services/repository', () => ({
	repository: {
		runDailyRollup: vi.fn().mockResolvedValue({
			streamDailyRolled: true,
		}),
		cleanupOldHistoryData: vi.fn().mockResolvedValue({
			streamHourlyDeleted: 5,
			streamDailyDeleted: 0,
			serverReliabilityDeleted: 0,
		}),
		rollupTorBoxOperationalDaily: vi.fn().mockResolvedValue(true),
		cleanupOldTorBoxOperationalData: vi.fn().mockResolvedValue({
			hourlyDeleted: 0,
			dailyDeleted: 0,
		}),
		rollupTorBoxCdnDaily: vi.fn().mockResolvedValue(true),
		cleanupOldTorBoxCdnData: vi.fn().mockResolvedValue({
			hourlyDeleted: 0,
			dailyDeleted: 0,
		}),
	},
}));

// Store original env
const originalEnv = process.env;

function createMockRequest(method: string, query: Record<string, string> = {}): NextApiRequest {
	return {
		method,
		query,
	} as unknown as NextApiRequest;
}

function createMockResponse() {
	const res: Partial<NextApiResponse> = {
		status: vi.fn().mockReturnThis(),
		json: vi.fn().mockReturnThis(),
		setHeader: vi.fn().mockReturnThis(),
	};
	return res as NextApiResponse;
}

describe('aggregate API endpoint', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env = { ...originalEnv };
		delete process.env.AGGREGATION_SECRET;
	});

	afterAll(() => {
		process.env = originalEnv;
	});

	it('returns 405 for non-POST requests', async () => {
		const req = createMockRequest('GET', {});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
	});

	it('runs daily rollup by default', async () => {
		const { repository } = await import('@/services/repository');
		const req = createMockRequest('POST', {});
		const res = createMockResponse();

		await handler(req, res);

		expect(repository.runDailyRollup).toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				success: true,
				action: 'daily',
				results: expect.objectContaining({
					dailyRollup: expect.any(Object),
				}),
			})
		);
	});

	it('runs cleanup when action=cleanup', async () => {
		const { repository } = await import('@/services/repository');
		const req = createMockRequest('POST', { action: 'cleanup' });
		const res = createMockResponse();

		await handler(req, res);

		expect(repository.cleanupOldHistoryData).toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				success: true,
				action: 'cleanup',
				results: expect.objectContaining({
					cleanup: expect.any(Object),
				}),
			})
		);
	});

	it('runs all actions when action=all', async () => {
		const { repository } = await import('@/services/repository');
		const req = createMockRequest('POST', { action: 'all' });
		const res = createMockResponse();

		await handler(req, res);

		expect(repository.runDailyRollup).toHaveBeenCalled();
		expect(repository.cleanupOldHistoryData).toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('returns 401 when secret is required but not provided', async () => {
		process.env.AGGREGATION_SECRET = 'mysecret';
		const req = createMockRequest('POST', {});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
	});

	it('returns 401 when secret is wrong', async () => {
		process.env.AGGREGATION_SECRET = 'mysecret';
		const req = createMockRequest('POST', { secret: 'wrongsecret' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
	});

	it('allows request when secret matches', async () => {
		process.env.AGGREGATION_SECRET = 'mysecret';
		const req = createMockRequest('POST', { secret: 'mysecret' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('handles errors gracefully', async () => {
		const { repository } = await import('@/services/repository');
		vi.mocked(repository.runDailyRollup).mockRejectedValueOnce(
			new Error('Database connection failed')
		);

		const req = createMockRequest('POST', {});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				success: false,
				error: 'Database connection failed',
			})
		);
	});
});
