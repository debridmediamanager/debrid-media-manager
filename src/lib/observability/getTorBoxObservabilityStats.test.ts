import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	USER_TRAFFIC_WINDOW_HOURS,
	getTorBoxObservabilityStats,
} from './getTorBoxObservabilityStats';

vi.mock('@/services/repository', () => ({
	repository: {
		getTorBoxOperationalStats: vi.fn(),
	},
}));

const { repository } = await import('@/services/repository');

const EMPTY_TB_API = {
	totalCount: 0,
	successCount: 0,
	failureCount: 0,
	successRate: 0,
	isDown: false,
	byOperation: {} as any,
	lastHour: null,
};

describe('getTorBoxObservabilityStats', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(repository.getTorBoxOperationalStats).mockResolvedValue(EMPTY_TB_API);
	});

	it('returns an empty but well-formed payload with no data', async () => {
		const stats = await getTorBoxObservabilityStats();

		expect(stats.tbApi).toEqual(EMPTY_TB_API);
		expect(stats.windowHours).toBe(USER_TRAFFIC_WINDOW_HOURS);
		expect(stats.lastChecked).toBeNull();
	});

	// A 1-hour window collapses to the current hour bucket alone, which at :01
	// past the hour is a minute of traffic - far too thin to drive a verdict.
	it('asks for a window wide enough to always cover a complete hour bucket', async () => {
		await getTorBoxObservabilityStats();

		expect(repository.getTorBoxOperationalStats).toHaveBeenCalledWith(
			USER_TRAFFIC_WINDOW_HOURS
		);
		expect(USER_TRAFFIC_WINDOW_HOURS).toBeGreaterThanOrEqual(2);
	});

	it('reports the newest populated hour bucket as the freshness stamp', async () => {
		vi.mocked(repository.getTorBoxOperationalStats).mockResolvedValue({
			...EMPTY_TB_API,
			totalCount: 120,
			successCount: 118,
			failureCount: 2,
			successRate: 118 / 120,
			lastHour: new Date('2026-08-25T05:00:00Z'),
		});

		const stats = await getTorBoxObservabilityStats();

		expect(stats.lastChecked).toBe(new Date('2026-08-25T05:00:00Z').getTime());
		expect(stats.tbApi?.successCount).toBe(118);
	});

	// The whole point of the refactor: nothing here may reach out to TorBox.
	// A probe from one datacentre IP measures that IP's rate-limit standing,
	// and TorBox 429s it often enough to read as a false outage.
	it('issues no outbound request of its own', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');

		await getTorBoxObservabilityStats();

		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});
});
