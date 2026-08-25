import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTorBoxObservabilityStats } from './getTorBoxObservabilityStats';

vi.mock('@/services/repository', () => ({
	repository: {
		getTorBoxCdnMetrics: vi.fn(),
		getAllTorBoxCdnStatuses: vi.fn(),
		getRecentTorBoxChecks: vi.fn(),
		getTorBoxOperationalStats: vi.fn(),
	},
}));

vi.mock('./torboxHealth', () => ({
	fetchServiceStats: vi.fn(),
	isTorBoxHealthCheckInProgress: vi.fn().mockReturnValue(false),
}));

const { repository } = await import('@/services/repository');
const { fetchServiceStats } = await import('./torboxHealth');

const EMPTY_METRICS = {
	total: 0,
	working: 0,
	rate: 0,
	lastChecked: null,
	avgLatencyMs: null,
	fastestNode: null,
	failedNodes: [],
};

const EMPTY_TB_API = {
	totalCount: 0,
	successCount: 0,
	failureCount: 0,
	successRate: 0,
	isDown: false,
	byOperation: {} as any,
	lastHour: null,
};

function status(overrides: Record<string, unknown> = {}) {
	return {
		host: 'nexus-067.ceur.tb-cdn.st',
		region: 'ceur',
		name: 'nexus-067',
		status: 206,
		latencyMs: 100,
		ok: true,
		error: null,
		checkedAt: new Date('2026-08-23T10:00:00Z'),
		...overrides,
	};
}

function check(overrides: Record<string, unknown> = {}) {
	return {
		apiOk: true,
		apiLatencyMs: 42,
		apiDetail: 'API is running.',
		totalNodes: 2,
		workingNodes: 2,
		checkedAt: new Date('2026-08-23T10:00:00Z'),
		...overrides,
	};
}

describe('getTorBoxObservabilityStats', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(repository.getTorBoxCdnMetrics).mockResolvedValue({ ...EMPTY_METRICS });
		vi.mocked(repository.getAllTorBoxCdnStatuses).mockResolvedValue([]);
		vi.mocked(repository.getRecentTorBoxChecks).mockResolvedValue([]);
		vi.mocked(repository.getTorBoxOperationalStats).mockResolvedValue(EMPTY_TB_API);
		vi.mocked(fetchServiceStats).mockResolvedValue({ totalUsers: 1, totalServers: 2 });
	});

	it('returns an empty but well-formed payload with no data', async () => {
		const stats = await getTorBoxObservabilityStats();

		expect(stats.cdn.total).toBe(0);
		expect(stats.api.ok).toBeNull();
		expect(stats.api.successRate).toBeNull();
		expect(stats.lastChecked).toBeNull();
	});

	// The user-traffic counters are what make this page the TorBox counterpart
	// of /is-real-debrid-down-or-just-me rather than a pure synthetic prober.
	it('carries the user API stats through untouched', async () => {
		const tbApi = {
			...EMPTY_TB_API,
			totalCount: 120,
			successCount: 118,
			failureCount: 2,
			successRate: 118 / 120,
			lastHour: new Date('2026-08-25T11:00:00Z'),
		};
		vi.mocked(repository.getTorBoxOperationalStats).mockResolvedValue(tbApi);

		const stats = await getTorBoxObservabilityStats();

		expect(stats.tbApi).toEqual(tbApi);
	});

	it('asks for the last hour of user traffic, matching the card label', async () => {
		await getTorBoxObservabilityStats();

		expect(repository.getTorBoxOperationalStats).toHaveBeenCalledWith(1);
	});

	it('sorts nodes with working ones first, fastest first', async () => {
		vi.mocked(repository.getAllTorBoxCdnStatuses).mockResolvedValue([
			status({ host: 'slow', latencyMs: 300 }),
			status({ host: 'dead', ok: false, latencyMs: null }),
			status({ host: 'fast', latencyMs: 50 }),
		]);

		const stats = await getTorBoxObservabilityStats();

		expect(stats.cdn.nodes.map((n) => n.host)).toEqual(['fast', 'slow', 'dead']);
	});

	it('summarises the API from the most recent check', async () => {
		vi.mocked(repository.getRecentTorBoxChecks).mockResolvedValue([
			check({ apiOk: false, apiDetail: 'ECONNREFUSED', apiLatencyMs: null }),
			check(),
			check(),
		]);

		const stats = await getTorBoxObservabilityStats();

		expect(stats.api.ok).toBe(false);
		expect(stats.api.detail).toBe('ECONNREFUSED');
		expect(stats.api.successCount).toBe(2);
		expect(stats.api.totalCount).toBe(3);
		expect(stats.api.successRate).toBeCloseTo(2 / 3);
	});

	// The page renders this timestamp instead of its own fetch time, so a
	// stalled collector shows as stale rather than looking permanently fresh.
	it('takes lastChecked from the freshest of the two clocks', async () => {
		vi.mocked(repository.getTorBoxCdnMetrics).mockResolvedValue({
			...EMPTY_METRICS,
			lastChecked: new Date('2026-08-23T10:00:00Z').getTime(),
		});
		vi.mocked(repository.getRecentTorBoxChecks).mockResolvedValue([
			check({ checkedAt: new Date('2026-08-23T10:05:00Z') }),
		]);

		const stats = await getTorBoxObservabilityStats();

		expect(stats.lastChecked).toBe(new Date('2026-08-23T10:05:00Z').getTime());
	});

	it('still reports lastChecked when only the CDN table was written', async () => {
		vi.mocked(repository.getTorBoxCdnMetrics).mockResolvedValue({
			...EMPTY_METRICS,
			lastChecked: new Date('2026-08-23T09:00:00Z').getTime(),
		});

		const stats = await getTorBoxObservabilityStats();

		expect(stats.lastChecked).toBe(new Date('2026-08-23T09:00:00Z').getTime());
	});

	// Public stats are contextual only - losing them must not fail the payload.
	it('degrades service stats to null without failing', async () => {
		vi.mocked(fetchServiceStats).mockRejectedValue(new Error('offline'));

		const stats = await getTorBoxObservabilityStats();

		expect(stats.service).toBeNull();
		expect(stats.cdn).toBeDefined();
	});
});
