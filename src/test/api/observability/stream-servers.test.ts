import { beforeEach, describe, expect, it, vi } from 'vitest';

const healthMocks = vi.hoisted(() => ({
	getStreamStatusesFromDb: vi.fn(),
}));

vi.mock('@/lib/observability/streamServersHealth', () => healthMocks);

import handler from '@/pages/api/observability/stream-servers';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('API /api/observability/stream-servers', () => {
	it('rejects non-GET requests', async () => {
		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.setHeader).toHaveBeenCalledWith('Allow', 'GET');
		expect(res._getData()).toEqual({ error: 'Method not allowed' });
	});

	it('sets no-cache headers', async () => {
		healthMocks.getStreamStatusesFromDb.mockResolvedValue([]);
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.setHeader).toHaveBeenCalledWith(
			'Cache-Control',
			'private, no-store, no-cache, must-revalidate'
		);
		expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
	});

	it('returns empty lists when no statuses exist', async () => {
		healthMocks.getStreamStatusesFromDb.mockResolvedValue([]);
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res._getData()).toEqual({
			total: 0,
			working: 0,
			failed: 0,
			workingServers: [],
			failedServers: [],
			lastChecked: null,
		});
	});

	it('separates working and failed servers', async () => {
		const now = new Date('2025-01-15T12:00:00Z');
		healthMocks.getStreamStatusesFromDb.mockResolvedValue([
			{
				host: 'server-a.example.com',
				status: 200,
				latencyMs: 100,
				ok: true,
				error: null,
				checkedAt: now,
			},
			{
				host: 'server-b.example.com',
				status: 500,
				latencyMs: null,
				ok: false,
				error: 'Connection refused',
				checkedAt: now,
			},
		]);

		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		const data = res._getData() as Record<string, unknown>;
		expect(data.total).toBe(2);
		expect(data.working).toBe(1);
		expect(data.failed).toBe(1);
		expect((data.workingServers as unknown[]).length).toBe(1);
		expect((data.failedServers as unknown[]).length).toBe(1);
	});

	it('sorts working servers by latency (fastest first)', async () => {
		const now = new Date('2025-01-15T12:00:00Z');
		healthMocks.getStreamStatusesFromDb.mockResolvedValue([
			{
				host: 'slow.example.com',
				status: 200,
				latencyMs: 500,
				ok: true,
				error: null,
				checkedAt: now,
			},
			{
				host: 'fast.example.com',
				status: 200,
				latencyMs: 50,
				ok: true,
				error: null,
				checkedAt: now,
			},
			{
				host: 'medium.example.com',
				status: 200,
				latencyMs: 200,
				ok: true,
				error: null,
				checkedAt: now,
			},
		]);

		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		const data = res._getData() as Record<string, unknown>;
		const working = data.workingServers as Array<{ host: string }>;
		expect(working[0].host).toBe('fast.example.com');
		expect(working[1].host).toBe('medium.example.com');
		expect(working[2].host).toBe('slow.example.com');
	});

	it('sorts failed servers alphabetically by host', async () => {
		const now = new Date('2025-01-15T12:00:00Z');
		healthMocks.getStreamStatusesFromDb.mockResolvedValue([
			{
				host: 'charlie.example.com',
				status: null,
				latencyMs: null,
				ok: false,
				error: 'timeout',
				checkedAt: now,
			},
			{
				host: 'alpha.example.com',
				status: null,
				latencyMs: null,
				ok: false,
				error: 'timeout',
				checkedAt: now,
			},
		]);

		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		const data = res._getData() as Record<string, unknown>;
		const failed = data.failedServers as Array<{ host: string }>;
		expect(failed[0].host).toBe('alpha.example.com');
		expect(failed[1].host).toBe('charlie.example.com');
	});

	it('uses latest checkedAt as lastChecked', async () => {
		healthMocks.getStreamStatusesFromDb.mockResolvedValue([
			{
				host: 'a.example.com',
				status: 200,
				latencyMs: 100,
				ok: true,
				error: null,
				checkedAt: new Date('2025-01-15T10:00:00Z'),
			},
			{
				host: 'b.example.com',
				status: 200,
				latencyMs: 100,
				ok: true,
				error: null,
				checkedAt: new Date('2025-01-15T12:00:00Z'),
			},
		]);

		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		const data = res._getData() as Record<string, unknown>;
		expect(data.lastChecked).toBe('2025-01-15T12:00:00.000Z');
	});

	it('handles null latency in sorting', async () => {
		const now = new Date('2025-01-15T12:00:00Z');
		healthMocks.getStreamStatusesFromDb.mockResolvedValue([
			{
				host: 'null-latency.example.com',
				status: 200,
				latencyMs: null,
				ok: true,
				error: null,
				checkedAt: now,
			},
			{
				host: 'fast.example.com',
				status: 200,
				latencyMs: 50,
				ok: true,
				error: null,
				checkedAt: now,
			},
		]);

		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		const data = res._getData() as Record<string, unknown>;
		const working = data.workingServers as Array<{ host: string }>;
		expect(working[0].host).toBe('fast.example.com');
		expect(working[1].host).toBe('null-latency.example.com');
	});

	it('returns 500 when getStreamStatusesFromDb throws', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		healthMocks.getStreamStatusesFromDb.mockRejectedValue(new Error('DB connection failed'));

		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res._getData()).toEqual({ error: 'Internal server error' });
	});
});
