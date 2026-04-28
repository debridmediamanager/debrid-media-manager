import { beforeEach, describe, expect, it, vi } from 'vitest';

const healthMocks = vi.hoisted(() => ({
	runHealthCheckNow: vi.fn(),
}));

const torrentioMocks = vi.hoisted(() => ({
	runTorrentioHealthCheckNow: vi.fn(),
}));

const repositoryMocks = vi.hoisted(() => ({
	repository: {
		runDailyRollup: vi.fn(),
	},
}));

vi.mock('@/lib/observability/streamServersHealth', () => healthMocks);
vi.mock('@/lib/observability/torrentioHealth', () => torrentioMocks);
vi.mock('@/services/repository', () => repositoryMocks);

import handler from '@/pages/api/observability/cron';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

const originalEnv = { ...process.env };

beforeEach(() => {
	vi.clearAllMocks();
	process.env = { ...originalEnv };
});

describe('API /api/observability/cron', () => {
	it('rejects non-POST requests', async () => {
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.setHeader).toHaveBeenCalledWith('Allow', 'POST');
		expect(res._getData()).toMatchObject({ success: false, error: 'Method not allowed' });
	});

	it('returns 401 when secret does not match', async () => {
		process.env.CRON_SECRET = 'correct-secret';
		const req = createMockRequest({
			method: 'POST',
			query: { secret: 'wrong-secret' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(res._getData()).toMatchObject({ success: false, error: 'Unauthorized' });
	});

	it('allows request when no CRON_SECRET is configured', async () => {
		delete process.env.CRON_SECRET;
		healthMocks.runHealthCheckNow.mockResolvedValue({
			working: 5,
			total: 10,
			rate: 0.5,
			avgLatencyMs: 120,
		});
		torrentioMocks.runTorrentioHealthCheckNow.mockResolvedValue(undefined);
		repositoryMocks.repository.runDailyRollup.mockResolvedValue({
			streamDailyRolled: true,
			rdDailyRolled: true,
			torrentioDailyRolled: true,
		});

		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res._getData()).toMatchObject({ success: true });
	});

	it('accepts secret via query param', async () => {
		process.env.CRON_SECRET = 'my-secret';
		healthMocks.runHealthCheckNow.mockResolvedValue({
			working: 3,
			total: 3,
			rate: 1,
			avgLatencyMs: 50,
		});
		torrentioMocks.runTorrentioHealthCheckNow.mockResolvedValue(undefined);
		repositoryMocks.repository.runDailyRollup.mockResolvedValue({
			streamDailyRolled: true,
			rdDailyRolled: false,
			torrentioDailyRolled: false,
		});

		const req = createMockRequest({
			method: 'POST',
			query: { secret: 'my-secret' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res._getData()).toMatchObject({ success: true });
	});

	it('accepts secret via x-cron-secret header', async () => {
		process.env.CRON_SECRET = 'header-secret';
		healthMocks.runHealthCheckNow.mockResolvedValue(null);
		torrentioMocks.runTorrentioHealthCheckNow.mockResolvedValue(undefined);
		repositoryMocks.repository.runDailyRollup.mockResolvedValue({
			streamDailyRolled: false,
			rdDailyRolled: false,
			torrentioDailyRolled: false,
		});

		const req = createMockRequest({
			method: 'POST',
			headers: { 'x-cron-secret': 'header-secret' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('returns stream health metrics when available', async () => {
		delete process.env.CRON_SECRET;
		healthMocks.runHealthCheckNow.mockResolvedValue({
			working: 8,
			total: 10,
			rate: 0.8,
			avgLatencyMs: 200,
		});
		torrentioMocks.runTorrentioHealthCheckNow.mockResolvedValue(undefined);
		repositoryMocks.repository.runDailyRollup.mockResolvedValue({
			streamDailyRolled: true,
			rdDailyRolled: true,
			torrentioDailyRolled: true,
		});

		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		const data = res._getData() as Record<string, unknown>;
		expect(data.streamHealth).toEqual({
			working: 8,
			total: 10,
			rate: 0.8,
			avgLatencyMs: 200,
		});
		expect(data.torrentioHealth).toEqual({ checked: true });
	});

	it('omits streamHealth when runHealthCheckNow returns null', async () => {
		delete process.env.CRON_SECRET;
		healthMocks.runHealthCheckNow.mockResolvedValue(null);
		torrentioMocks.runTorrentioHealthCheckNow.mockResolvedValue(undefined);
		repositoryMocks.repository.runDailyRollup.mockResolvedValue({
			streamDailyRolled: false,
			rdDailyRolled: false,
			torrentioDailyRolled: false,
		});

		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		const data = res._getData() as Record<string, unknown>;
		expect(data.streamHealth).toBeUndefined();
	});

	it('includes daily rollup results', async () => {
		delete process.env.CRON_SECRET;
		healthMocks.runHealthCheckNow.mockResolvedValue(null);
		torrentioMocks.runTorrentioHealthCheckNow.mockResolvedValue(undefined);
		repositoryMocks.repository.runDailyRollup.mockResolvedValue({
			streamDailyRolled: true,
			rdDailyRolled: false,
			torrentioDailyRolled: true,
		});

		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		const data = res._getData() as Record<string, unknown>;
		expect(data.dailyRollup).toEqual({
			streamDailyRolled: true,
			rdDailyRolled: false,
			torrentioDailyRolled: true,
		});
	});

	it('handles daily rollup failure gracefully', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		delete process.env.CRON_SECRET;
		healthMocks.runHealthCheckNow.mockResolvedValue(null);
		torrentioMocks.runTorrentioHealthCheckNow.mockResolvedValue(undefined);
		repositoryMocks.repository.runDailyRollup.mockRejectedValue(new Error('DB error'));

		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		const data = res._getData() as Record<string, unknown>;
		expect(data.success).toBe(true);
		expect(data.dailyRollup).toBeUndefined();
	});

	it('returns 500 when health check throws', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		delete process.env.CRON_SECRET;
		healthMocks.runHealthCheckNow.mockRejectedValue(new Error('Connection timeout'));
		torrentioMocks.runTorrentioHealthCheckNow.mockResolvedValue(undefined);

		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res._getData()).toMatchObject({
			success: false,
			error: 'Connection timeout',
		});
	});

	it('returns 500 with "Unknown error" for non-Error throws', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		delete process.env.CRON_SECRET;
		healthMocks.runHealthCheckNow.mockRejectedValue('string error');
		torrentioMocks.runTorrentioHealthCheckNow.mockResolvedValue(undefined);

		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res._getData()).toMatchObject({
			success: false,
			error: 'Unknown error',
		});
	});
});
