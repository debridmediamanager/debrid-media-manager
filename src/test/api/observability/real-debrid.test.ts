import { beforeEach, describe, expect, it, vi } from 'vitest';

const statsMocks = vi.hoisted(() => ({
	getRealDebridObservabilityStatsFromDb: vi.fn(),
	getRealDebridObservabilityStats: vi.fn(),
}));

vi.mock('@/lib/observability/getRealDebridObservabilityStats', () => statsMocks);

import handler from '@/pages/api/observability/real-debrid';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('API /api/observability/real-debrid', () => {
	it('rejects non-GET requests', async () => {
		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.setHeader).toHaveBeenCalledWith('Allow', 'GET');
		expect(res._getData()).toEqual({ error: 'Method not allowed' });
	});

	it('rejects PUT requests', async () => {
		const req = createMockRequest({ method: 'PUT' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
	});

	it('sets no-cache headers', async () => {
		statsMocks.getRealDebridObservabilityStatsFromDb.mockResolvedValue({ total: 0 });
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.setHeader).toHaveBeenCalledWith(
			'Cache-Control',
			'private, no-store, no-cache, must-revalidate'
		);
		expect(res.setHeader).toHaveBeenCalledWith('CDN-Cache-Control', 'no-store');
		expect(res.setHeader).toHaveBeenCalledWith('Vercel-CDN-Cache-Control', 'no-store');
		expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
		expect(res.setHeader).toHaveBeenCalledWith('Expires', '0');
	});

	it('returns DB-backed stats on success', async () => {
		const mockStats = {
			totalRequests: 1000,
			successRate: 0.95,
			avgLatencyMs: 150,
		};
		statsMocks.getRealDebridObservabilityStatsFromDb.mockResolvedValue(mockStats);

		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res._getData()).toEqual(mockStats);
		expect(statsMocks.getRealDebridObservabilityStats).not.toHaveBeenCalled();
	});

	it('falls back to in-memory stats when DB read fails', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const inMemoryStats = {
			totalRequests: 500,
			successRate: 0.9,
			avgLatencyMs: 200,
		};
		statsMocks.getRealDebridObservabilityStatsFromDb.mockRejectedValue(new Error('DB error'));
		statsMocks.getRealDebridObservabilityStats.mockReturnValue(inMemoryStats);

		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res._getData()).toEqual(inMemoryStats);
		expect(statsMocks.getRealDebridObservabilityStats).toHaveBeenCalled();
	});
});
