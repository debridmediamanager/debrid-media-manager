import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository', () => ({
	repository: {
		getRecentStreamChecks: vi.fn(),
		getRdStats: vi.fn(),
		getRecentTorrentioChecks: vi.fn(),
	},
}));

vi.mock('./streamServersHealth', () => ({
	getStreamMetricsFromDb: vi.fn(),
	getStreamStatusesFromDb: vi.fn(),
	isHealthCheckInProgress: vi.fn(),
}));

vi.mock('./torrentioHealth', () => ({
	isTorrentioHealthCheckInProgress: vi.fn(),
}));

import { repository } from '@/services/repository';
import { getRealDebridObservabilityStatsFromDb } from './getRealDebridObservabilityStats';
import {
	getStreamMetricsFromDb,
	getStreamStatusesFromDb,
	isHealthCheckInProgress,
} from './streamServersHealth';
import { isTorrentioHealthCheckInProgress } from './torrentioHealth';

const mockGetStreamMetrics = vi.mocked(getStreamMetricsFromDb);
const mockGetStreamStatuses = vi.mocked(getStreamStatusesFromDb);
const mockIsHealthCheckInProgress = vi.mocked(isHealthCheckInProgress);
const mockIsTorrentioInProgress = vi.mocked(isTorrentioHealthCheckInProgress);
const mockGetRecentStreamChecks = vi.mocked(repository.getRecentStreamChecks);
const mockGetRdStats = vi.mocked(repository.getRdStats);
const mockGetRecentTorrentioChecks = vi.mocked(repository.getRecentTorrentioChecks);

function defaultMetrics() {
	return {
		total: 10,
		working: 8,
		rate: 0.8,
		lastChecked: Date.now(),
		failedServers: ['server3', 'server7'],
		avgLatencyMs: 150,
		fastestServer: 'server1',
	};
}

function defaultStatuses() {
	return [
		{ host: 'server2', ok: true, latencyMs: 200 },
		{ host: 'server1', ok: true, latencyMs: 100 },
		{ host: 'server3', ok: false, latencyMs: null },
	];
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetStreamMetrics.mockResolvedValue(defaultMetrics());
	mockGetStreamStatuses.mockResolvedValue(defaultStatuses() as any);
	mockIsHealthCheckInProgress.mockReturnValue(false);
	mockIsTorrentioInProgress.mockReturnValue(false);
	mockGetRecentStreamChecks.mockResolvedValue([]);
	mockGetRdStats.mockResolvedValue(null as any);
	mockGetRecentTorrentioChecks.mockResolvedValue([]);
});

describe('getRealDebridObservabilityStatsFromDb', () => {
	it('returns complete stats structure', async () => {
		const result = await getRealDebridObservabilityStatsFromDb();

		expect(result).toHaveProperty('workingStream');
		expect(result).toHaveProperty('rdApi');
		expect(result).toHaveProperty('torrentio');
		expect(result.workingStream.total).toBe(10);
		expect(result.workingStream.working).toBe(8);
		expect(result.workingStream.rate).toBe(0.8);
		expect(result.workingStream.failedServers).toEqual(['server3', 'server7']);
		expect(result.workingStream.lastError).toBeNull();
	});

	it('sorts working servers by latency (lowest first)', async () => {
		const result = await getRealDebridObservabilityStatsFromDb();

		expect(result.workingStream.workingServers).toEqual([
			{ server: 'server1', latencyMs: 100 },
			{ server: 'server2', latencyMs: 200 },
		]);
	});

	it('converts checkedAt dates to timestamps', async () => {
		const date1 = new Date('2024-01-01T00:00:00Z');
		const date2 = new Date('2024-01-02T00:00:00Z');

		mockGetRecentStreamChecks.mockResolvedValue([
			{ ok: true, latencyMs: 100, server: 'server1', checkedAt: date1 },
			{ ok: false, latencyMs: null, server: 'server2', checkedAt: date2 },
		] as any);

		const result = await getRealDebridObservabilityStatsFromDb();

		expect(result.workingStream.recentChecks[0].checkedAt).toBe(date1.getTime());
		expect(result.workingStream.recentChecks[1].checkedAt).toBe(date2.getTime());
	});

	it('reflects health check in-progress state', async () => {
		mockIsHealthCheckInProgress.mockReturnValue(true);
		mockIsTorrentioInProgress.mockReturnValue(true);

		const result = await getRealDebridObservabilityStatsFromDb();

		expect(result.workingStream.inProgress).toBe(true);
		expect(result.torrentio?.inProgress).toBe(true);
	});

	it('handles null/empty data gracefully', async () => {
		mockGetStreamMetrics.mockResolvedValue({
			total: 0,
			working: 0,
			rate: 0,
			lastChecked: null,
			failedServers: [],
			avgLatencyMs: null,
			fastestServer: null,
		});
		mockGetStreamStatuses.mockResolvedValue([]);
		mockGetRdStats.mockResolvedValue(null as any);

		const result = await getRealDebridObservabilityStatsFromDb();

		expect(result.workingStream.total).toBe(0);
		expect(result.workingStream.workingServers).toEqual([]);
		expect(result.workingStream.recentChecks).toEqual([]);
		expect(result.rdApi).toBeNull();
	});

	it('places servers with null latency after those with values', async () => {
		mockGetStreamStatuses.mockResolvedValue([
			{ host: 'serverA', ok: true, latencyMs: null },
			{ host: 'serverB', ok: true, latencyMs: 50 },
		] as any);

		const result = await getRealDebridObservabilityStatsFromDb();

		expect(result.workingStream.workingServers[0].server).toBe('serverB');
		expect(result.workingStream.workingServers[1].server).toBe('serverA');
	});
});
