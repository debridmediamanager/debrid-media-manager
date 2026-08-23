import { beforeEach, describe, expect, it, vi } from 'vitest';

const statsMocks = vi.hoisted(() => ({
	getTorBoxObservabilityStats: vi.fn(),
}));

vi.mock('@/lib/observability/getTorBoxObservabilityStats', () => statsMocks);

import handler from '@/pages/api/observability/torbox';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('API /api/observability/torbox', () => {
	it('rejects non-GET requests', async () => {
		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.setHeader).toHaveBeenCalledWith('Allow', 'GET');
		expect(res._getData()).toEqual({ error: 'Method not allowed' });
	});

	it('sets no-cache headers', async () => {
		statsMocks.getTorBoxObservabilityStats.mockResolvedValue({ cdn: {}, api: {} });
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.setHeader).toHaveBeenCalledWith(
			'Cache-Control',
			'private, no-store, no-cache, must-revalidate'
		);
		expect(res.setHeader).toHaveBeenCalledWith('CDN-Cache-Control', 'no-store');
		expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
		expect(res.setHeader).toHaveBeenCalledWith('Expires', '0');
	});

	it('returns the stats payload', async () => {
		const payload = { cdn: { total: 17 }, api: { ok: true } };
		statsMocks.getTorBoxObservabilityStats.mockResolvedValue(payload);

		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res._getData()).toEqual(payload);
	});

	it('returns 500 when the stats lookup throws', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		statsMocks.getTorBoxObservabilityStats.mockRejectedValue(new Error('DB error'));

		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res._getData()).toEqual({ error: 'Internal server error' });
	});
});
