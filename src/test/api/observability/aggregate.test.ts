import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRepository = vi.hoisted(() => ({
	repository: {
		runDailyRollup: vi.fn(),
		cleanupOldHistoryData: vi.fn(),
	},
}));

vi.mock('@/services/repository', () => mockRepository);

import handler from '@/pages/api/observability/aggregate';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

const originalEnv = { ...process.env };

beforeEach(() => {
	vi.clearAllMocks();
	process.env = { ...originalEnv };
	delete process.env.AGGREGATION_SECRET;
});

describe('/api/observability/aggregate', () => {
	it('returns 405 for non-POST requests', async () => {
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
		expect(res.setHeader).toHaveBeenCalledWith('Allow', 'POST');
	});

	it('returns 401 when secret is required but missing', async () => {
		process.env.AGGREGATION_SECRET = 'my-secret';
		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
	});

	it('returns 401 when secret is wrong', async () => {
		process.env.AGGREGATION_SECRET = 'my-secret';
		const req = createMockRequest({ method: 'POST', query: { secret: 'wrong' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
	});

	it('allows access when secret matches', async () => {
		process.env.AGGREGATION_SECRET = 'my-secret';
		mockRepository.repository.runDailyRollup.mockResolvedValue({ rows: 10 });
		const req = createMockRequest({ method: 'POST', query: { secret: 'my-secret' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('allows access when no secret is configured', async () => {
		mockRepository.repository.runDailyRollup.mockResolvedValue({ rows: 10 });
		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('defaults to daily action', async () => {
		mockRepository.repository.runDailyRollup.mockResolvedValue({ rows: 5 });
		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.repository.runDailyRollup).toHaveBeenCalled();
		expect(mockRepository.repository.cleanupOldHistoryData).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(200);
		const data = res._getData() as any;
		expect(data.success).toBe(true);
		expect(data.action).toBe('daily');
		expect(data.results.dailyRollup).toEqual({ rows: 5 });
		expect(data.timestamp).toBeDefined();
	});

	it('runs cleanup action', async () => {
		mockRepository.repository.cleanupOldHistoryData.mockResolvedValue({ deleted: 100 });
		const req = createMockRequest({ method: 'POST', query: { action: 'cleanup' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.repository.cleanupOldHistoryData).toHaveBeenCalled();
		expect(mockRepository.repository.runDailyRollup).not.toHaveBeenCalled();
		const data = res._getData() as any;
		expect(data.results.cleanup).toEqual({ deleted: 100 });
	});

	it('runs both daily and cleanup for all action', async () => {
		mockRepository.repository.runDailyRollup.mockResolvedValue({ rows: 5 });
		mockRepository.repository.cleanupOldHistoryData.mockResolvedValue({ deleted: 100 });
		const req = createMockRequest({ method: 'POST', query: { action: 'all' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.repository.runDailyRollup).toHaveBeenCalled();
		expect(mockRepository.repository.cleanupOldHistoryData).toHaveBeenCalled();
		const data = res._getData() as any;
		expect(data.results.dailyRollup).toEqual({ rows: 5 });
		expect(data.results.cleanup).toEqual({ deleted: 100 });
	});

	it('returns 500 on daily rollup failure', async () => {
		mockRepository.repository.runDailyRollup.mockRejectedValue(new Error('Rollup failed'));
		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		const data = res._getData() as any;
		expect(data.success).toBe(false);
		expect(data.error).toBe('Rollup failed');
	});

	it('returns 500 on cleanup failure', async () => {
		mockRepository.repository.cleanupOldHistoryData.mockRejectedValue(
			new Error('Cleanup failed')
		);
		const req = createMockRequest({ method: 'POST', query: { action: 'cleanup' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		const data = res._getData() as any;
		expect(data.success).toBe(false);
		expect(data.error).toBe('Cleanup failed');
	});

	it('returns generic error message for non-Error throws', async () => {
		mockRepository.repository.runDailyRollup.mockRejectedValue('string error');
		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		const data = res._getData() as any;
		expect(data.error).toBe('Unknown error');
	});
});
