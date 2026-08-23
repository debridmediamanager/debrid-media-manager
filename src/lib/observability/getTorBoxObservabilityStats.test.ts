import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTorBoxObservabilityStats } from './getTorBoxObservabilityStats';

vi.mock('@/services/repository', () => ({
	repository: {
		getTorBoxCdnMetrics: vi.fn(),
		getAllTorBoxCdnStatuses: vi.fn(),
		getRecentTorBoxChecks: vi.fn(),
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
		authState: 'ok' as const,
		authError: null,
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
		vi.mocked(fetchServiceStats).mockResolvedValue({ totalUsers: 1, totalServers: 2 });
	});

	it('returns an empty but well-formed payload with no data', async () => {
		const stats = await getTorBoxObservabilityStats();

		expect(stats.cdn.total).toBe(0);
		expect(stats.api.ok).toBeNull();
		expect(stats.api.successRate).toBeNull();
		expect(stats.auth.state).toBe('skipped');
		expect(stats.lastChecked).toBeNull();
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

	it('surfaces the latest auth state', async () => {
		vi.mocked(repository.getRecentTorBoxChecks).mockResolvedValue([
			check({ authState: 'credentials', authError: 'AUTH_ERROR: Bad key' }),
		]);

		const stats = await getTorBoxObservabilityStats();

		expect(stats.auth).toEqual({ state: 'credentials', error: 'AUTH_ERROR: Bad key' });
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
