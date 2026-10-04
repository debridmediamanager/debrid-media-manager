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
		rollupTorBoxOperationalDaily: vi.fn(),
		rollupTorBoxCdnDaily: vi.fn(),
	},
}));

// The sweep lists the transfer services over the network, which no unit test
// may reach; `cron.filing.test.ts` drives the real one from recorded answers.
const filingMocks = vi.hoisted(() => ({
	fileCompletedTransfers: vi.fn(),
}));

vi.mock('@/lib/observability/streamServersHealth', () => healthMocks);
vi.mock('@/lib/observability/torrentioHealth', () => torrentioMocks);
vi.mock('@/services/repository', () => repositoryMocks);
vi.mock('@/services/transferFilingSweep', () => filingMocks);

// The sweep reads the library tables; `sweep.test.ts` drives the real one from
// recorded pages.
const trashSweepMocks = vi.hoisted(() => ({ sweepWrittenBackTrash: vi.fn() }));
vi.mock('@/services/scrapedVerdicts/sweep', () => trashSweepMocks);

import handler from '@/pages/api/observability/cron';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

const originalEnv = { ...process.env };

beforeEach(() => {
	vi.clearAllMocks();
	process.env = { ...originalEnv };
	filingMocks.fileCompletedTransfers.mockResolvedValue(undefined);
	trashSweepMocks.sweepWrittenBackTrash.mockResolvedValue(undefined);
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
		repositoryMocks.repository.rollupTorBoxOperationalDaily.mockResolvedValue(true);
		repositoryMocks.repository.rollupTorBoxCdnDaily.mockResolvedValue(true);

		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		const data = res._getData() as Record<string, unknown>;
		expect(data.dailyRollup).toEqual({
			streamDailyRolled: true,
			rdDailyRolled: false,
			torrentioDailyRolled: true,
			torboxApiDailyRolled: true,
			torboxCdnDailyRolled: true,
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

	it('files completed transfers on every tick and reports what it did', async () => {
		delete process.env.CRON_SECRET;
		healthMocks.runHealthCheckNow.mockResolvedValue(null);
		torrentioMocks.runTorrentioHealthCheckNow.mockResolvedValue(undefined);
		const sweep = { completed: 12, due: 2, filed: 2, refused: 0 };
		filingMocks.fileCompletedTransfers.mockResolvedValue(sweep);

		const res = createMockResponse();
		await handler(createMockRequest({ method: 'POST' }), res);

		expect(filingMocks.fileCompletedTransfers).toHaveBeenCalledTimes(1);
		expect(res._getData()).toMatchObject({ success: true, transferFilings: sweep });
	});

	it('keeps the tick when filing completed transfers throws', async () => {
		delete process.env.CRON_SECRET;
		healthMocks.runHealthCheckNow.mockResolvedValue(null);
		torrentioMocks.runTorrentioHealthCheckNow.mockResolvedValue(undefined);
		filingMocks.fileCompletedTransfers.mockRejectedValue(new Error('nzb2rd down'));

		const res = createMockResponse();
		await handler(createMockRequest({ method: 'POST' }), res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res._getData()).toMatchObject({ success: true, transferFilings: undefined });
	});

	it('moves written-back trash off movie pages on every tick and reports what it did', async () => {
		delete process.env.CRON_SECRET;
		healthMocks.runHealthCheckNow.mockResolvedValue(null);
		torrentioMocks.runTorrentioHealthCheckNow.mockResolvedValue(undefined);
		const sweep = { status: 'done', pages: 9, judgedPages: 4, moved: 33, failed: 0 };
		trashSweepMocks.sweepWrittenBackTrash.mockResolvedValue(sweep);

		const res = createMockResponse();
		await handler(createMockRequest({ method: 'POST' }), res);

		expect(trashSweepMocks.sweepWrittenBackTrash).toHaveBeenCalledTimes(1);
		expect(res._getData()).toMatchObject({ success: true, writtenBackTrash: sweep });
	});

	it('keeps the tick when moving written-back trash throws', async () => {
		delete process.env.CRON_SECRET;
		healthMocks.runHealthCheckNow.mockResolvedValue(null);
		torrentioMocks.runTorrentioHealthCheckNow.mockResolvedValue(undefined);
		trashSweepMocks.sweepWrittenBackTrash.mockRejectedValue(new Error('Lock wait timeout'));

		const res = createMockResponse();
		await handler(createMockRequest({ method: 'POST' }), res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res._getData()).toMatchObject({ success: true, writtenBackTrash: undefined });
	});
});
