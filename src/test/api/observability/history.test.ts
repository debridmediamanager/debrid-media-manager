import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRepository = vi.hoisted(() => ({
	repository: {
		getStreamHourlyHistory: vi.fn(),
		getStreamDailyHistory: vi.fn(),
		getServerReliability: vi.fn(),
		getRdHourlyHistory: vi.fn(),
		getRdDailyHistory: vi.fn(),
		getTorrentioHourlyHistory: vi.fn(),
		getTorrentioDailyHistory: vi.fn(),
		getTorBoxOperationalHourlyHistory: vi.fn(),
		getTorBoxOperationalDailyHistory: vi.fn(),
		getTorBoxCdnHourlyHistory: vi.fn(),
		getTorBoxCdnDailyHistory: vi.fn(),
		getTorBoxCdnRegionSummary: vi.fn(),
	},
}));

vi.mock('@/services/repository', () => mockRepository);

import handler from '@/pages/api/observability/history';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('/api/observability/history', () => {
	it('returns 405 for non-GET requests', async () => {
		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
		expect(res.setHeader).toHaveBeenCalledWith('Allow', 'GET');
	});

	it('sets no-cache headers', async () => {
		mockRepository.repository.getStreamHourlyHistory.mockResolvedValue([]);
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.setHeader).toHaveBeenCalledWith(
			'Cache-Control',
			'private, no-store, no-cache, must-revalidate'
		);
		expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
	});

	it('defaults to stream type and 24h range', async () => {
		const mockData = [{ hour: '2024-01-01T00:00:00Z', count: 10 }];
		mockRepository.repository.getStreamHourlyHistory.mockResolvedValue(mockData);
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.repository.getStreamHourlyHistory).toHaveBeenCalledWith(24);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			type: 'stream',
			granularity: 'hourly',
			range: '24h',
			data: mockData,
		});
	});

	it('returns hourly stream data for 7d range', async () => {
		const mockData = [{ hour: '2024-01-01T00:00:00Z', count: 5 }];
		mockRepository.repository.getStreamHourlyHistory.mockResolvedValue(mockData);
		const req = createMockRequest({ method: 'GET', query: { type: 'stream', range: '7d' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.repository.getStreamHourlyHistory).toHaveBeenCalledWith(168);
		expect(res.json).toHaveBeenCalledWith({
			type: 'stream',
			granularity: 'hourly',
			range: '7d',
			data: mockData,
		});
	});

	it('returns daily stream data for 30d range', async () => {
		const mockData = [{ day: '2024-01-01', count: 100 }];
		mockRepository.repository.getStreamDailyHistory.mockResolvedValue(mockData);
		const req = createMockRequest({ method: 'GET', query: { type: 'stream', range: '30d' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.repository.getStreamDailyHistory).toHaveBeenCalledWith(30);
		expect(res.json).toHaveBeenCalledWith({
			type: 'stream',
			granularity: 'daily',
			range: '30d',
			data: mockData,
		});
	});

	it('falls back to hourly when daily rollup is empty for stream 30d', async () => {
		const mockHourly = [{ hour: '2024-01-01T00:00:00Z', count: 5 }];
		mockRepository.repository.getStreamDailyHistory.mockResolvedValue([]);
		mockRepository.repository.getStreamHourlyHistory.mockResolvedValue(mockHourly);
		const req = createMockRequest({ method: 'GET', query: { type: 'stream', range: '30d' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.repository.getStreamHourlyHistory).toHaveBeenCalledWith(2160);
		expect(res.json).toHaveBeenCalledWith({
			type: 'stream',
			granularity: 'hourly',
			range: '30d',
			data: mockHourly,
		});
	});

	it('returns daily stream data for 90d range', async () => {
		const mockData = [{ day: '2024-01-01', count: 200 }];
		mockRepository.repository.getStreamDailyHistory.mockResolvedValue(mockData);
		const req = createMockRequest({ method: 'GET', query: { type: 'stream', range: '90d' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.repository.getStreamDailyHistory).toHaveBeenCalledWith(90);
		expect(res.json).toHaveBeenCalledWith({
			type: 'stream',
			granularity: 'daily',
			range: '90d',
			data: mockData,
		});
	});

	it('returns server reliability data', async () => {
		const mockData = [{ server: 's1', reliability: 99.5 }];
		mockRepository.repository.getServerReliability.mockResolvedValue(mockData);
		const req = createMockRequest({ method: 'GET', query: { type: 'servers' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.repository.getServerReliability).toHaveBeenCalledWith(
			1,
			'reliability',
			50
		);
		expect(res.json).toHaveBeenCalledWith({
			type: 'servers',
			range: '24h',
			sortBy: 'reliability',
			data: mockData,
		});
	});

	it('respects sortBy and limit for servers', async () => {
		mockRepository.repository.getServerReliability.mockResolvedValue([]);
		const req = createMockRequest({
			method: 'GET',
			query: { type: 'servers', sortBy: 'latency', limit: '10', range: '7d' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.repository.getServerReliability).toHaveBeenCalledWith(
			7,
			'latency',
			10
		);
	});

	it('returns hourly rd data for 24h range', async () => {
		const mockData = [{ hour: '2024-01-01T00:00:00Z', status: 'ok' }];
		mockRepository.repository.getRdHourlyHistory.mockResolvedValue(mockData);
		const req = createMockRequest({ method: 'GET', query: { type: 'rd' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.repository.getRdHourlyHistory).toHaveBeenCalledWith(24);
		expect(res.json).toHaveBeenCalledWith({
			type: 'rd',
			granularity: 'hourly',
			range: '24h',
			data: mockData,
		});
	});

	it('returns daily rd data for 30d range', async () => {
		const mockData = [{ day: '2024-01-01', status: 'ok' }];
		mockRepository.repository.getRdDailyHistory.mockResolvedValue(mockData);
		const req = createMockRequest({ method: 'GET', query: { type: 'rd', range: '30d' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.repository.getRdDailyHistory).toHaveBeenCalledWith(30);
		expect(res.json).toHaveBeenCalledWith({
			type: 'rd',
			granularity: 'daily',
			range: '30d',
			data: mockData,
		});
	});

	it('falls back to hourly when daily rollup is empty for rd', async () => {
		const mockHourly = [{ hour: '2024-01-01T00:00:00Z', status: 'ok' }];
		mockRepository.repository.getRdDailyHistory.mockResolvedValue([]);
		mockRepository.repository.getRdHourlyHistory.mockResolvedValue(mockHourly);
		const req = createMockRequest({ method: 'GET', query: { type: 'rd', range: '30d' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.repository.getRdHourlyHistory).toHaveBeenCalledWith(2160);
		expect(res.json).toHaveBeenCalledWith({
			type: 'rd',
			granularity: 'hourly',
			range: '30d',
			data: mockHourly,
		});
	});

	it('returns hourly torrentio data for 24h range', async () => {
		const mockData = [{ hour: '2024-01-01T00:00:00Z', count: 50 }];
		mockRepository.repository.getTorrentioHourlyHistory.mockResolvedValue(mockData);
		const req = createMockRequest({ method: 'GET', query: { type: 'torrentio' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.repository.getTorrentioHourlyHistory).toHaveBeenCalledWith(24);
		expect(res.json).toHaveBeenCalledWith({
			type: 'torrentio',
			granularity: 'hourly',
			range: '24h',
			data: mockData,
		});
	});

	it('returns daily torrentio data for 30d range', async () => {
		const mockData = [{ day: '2024-01-01', count: 500 }];
		mockRepository.repository.getTorrentioDailyHistory.mockResolvedValue(mockData);
		const req = createMockRequest({
			method: 'GET',
			query: { type: 'torrentio', range: '30d' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.repository.getTorrentioDailyHistory).toHaveBeenCalledWith(30);
		expect(res.json).toHaveBeenCalledWith({
			type: 'torrentio',
			granularity: 'daily',
			range: '30d',
			data: mockData,
		});
	});

	it('falls back to hourly when daily rollup is empty for torrentio', async () => {
		const mockHourly = [{ hour: '2024-01-01T00:00:00Z', count: 50 }];
		mockRepository.repository.getTorrentioDailyHistory.mockResolvedValue([]);
		mockRepository.repository.getTorrentioHourlyHistory.mockResolvedValue(mockHourly);
		const req = createMockRequest({
			method: 'GET',
			query: { type: 'torrentio', range: '30d' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.repository.getTorrentioHourlyHistory).toHaveBeenCalledWith(2160);
		expect(res.json).toHaveBeenCalledWith({
			type: 'torrentio',
			granularity: 'hourly',
			range: '30d',
			data: mockHourly,
		});
	});

	// The synthetic CDN/API series is gone: DMM no longer probes TorBox itself,
	// so there is nothing behind type=torbox to serve.
	it('rejects the retired synthetic torbox history type', async () => {
		const req = createMockRequest({ method: 'GET', query: { type: 'torbox' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Invalid type parameter' });
	});

	it('returns hourly torbox-api data for 24h range', async () => {
		const mockData = [{ hour: '2026-08-25T00:00:00Z', totalCount: 40, successRate: 0.975 }];
		mockRepository.repository.getTorBoxOperationalHourlyHistory.mockResolvedValue(mockData);
		const req = createMockRequest({ method: 'GET', query: { type: 'torbox-api' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.repository.getTorBoxOperationalHourlyHistory).toHaveBeenCalledWith(
			24
		);
		expect(res.json).toHaveBeenCalledWith({
			type: 'torbox-api',
			granularity: 'hourly',
			range: '24h',
			data: mockData,
		});
	});

	it('returns daily torbox-api data for 90d range', async () => {
		const mockData = [{ date: '2026-08-24', totalCount: 900, avgSuccessRate: 0.99 }];
		mockRepository.repository.getTorBoxOperationalDailyHistory.mockResolvedValue(mockData);
		const req = createMockRequest({
			method: 'GET',
			query: { type: 'torbox-api', range: '90d' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.repository.getTorBoxOperationalDailyHistory).toHaveBeenCalledWith(90);
		expect(res.json).toHaveBeenCalledWith({
			type: 'torbox-api',
			granularity: 'daily',
			range: '90d',
			data: mockData,
		});
	});

	it('falls back to hourly when daily rollup is empty for torbox-api', async () => {
		const mockHourly = [{ hour: '2026-08-25T00:00:00Z', totalCount: 40, successRate: 1 }];
		mockRepository.repository.getTorBoxOperationalDailyHistory.mockResolvedValue([]);
		mockRepository.repository.getTorBoxOperationalHourlyHistory.mockResolvedValue(mockHourly);
		const req = createMockRequest({
			method: 'GET',
			query: { type: 'torbox-api', range: '30d' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.repository.getTorBoxOperationalHourlyHistory).toHaveBeenCalledWith(
			2160
		);
		expect(res.json).toHaveBeenCalledWith({
			type: 'torbox-api',
			granularity: 'hourly',
			range: '30d',
			data: mockHourly,
		});
	});

	describe('torbox-cdn', () => {
		const regions = [
			{ region: 'enam', okCount: 0, failCount: 40, rate: 0, avgLatencyMs: null },
		];

		beforeEach(() => {
			mockRepository.repository.getTorBoxCdnRegionSummary.mockResolvedValue(regions);
		});

		it('returns hourly buckets and the region breakdown for a 24h range', async () => {
			const mockData = [
				{ time: '2026-08-28T12:00:00Z', okCount: 130, failCount: 40, rate: 0.76 },
			];
			mockRepository.repository.getTorBoxCdnHourlyHistory.mockResolvedValue(mockData);
			const res = createMockResponse();

			await handler(createMockRequest({ method: 'GET', query: { type: 'torbox-cdn' } }), res);

			expect(mockRepository.repository.getTorBoxCdnHourlyHistory).toHaveBeenCalledWith(24);
			expect(res.json).toHaveBeenCalledWith({
				type: 'torbox-cdn',
				granularity: 'hourly',
				range: '24h',
				data: mockData,
				regions,
				regionWindowHours: 24,
			});
		});

		it('returns daily buckets for a 90d range', async () => {
			const mockData = [
				{ time: '2026-08-27T00:00:00Z', okCount: 900, failCount: 100, rate: 0.9 },
			];
			mockRepository.repository.getTorBoxCdnDailyHistory.mockResolvedValue(mockData);
			const res = createMockResponse();

			await handler(
				createMockRequest({ method: 'GET', query: { type: 'torbox-cdn', range: '90d' } }),
				res
			);

			expect(mockRepository.repository.getTorBoxCdnDailyHistory).toHaveBeenCalledWith(90);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({ granularity: 'daily', data: mockData })
			);
		});

		it('falls back to hourly when the daily rollup has not run yet', async () => {
			const mockHourly = [
				{ time: '2026-08-28T12:00:00Z', okCount: 10, failCount: 0, rate: 1 },
			];
			mockRepository.repository.getTorBoxCdnDailyHistory.mockResolvedValue([]);
			mockRepository.repository.getTorBoxCdnHourlyHistory.mockResolvedValue(mockHourly);
			const res = createMockResponse();

			await handler(
				createMockRequest({ method: 'GET', query: { type: 'torbox-cdn', range: '30d' } }),
				res
			);

			expect(mockRepository.repository.getTorBoxCdnHourlyHistory).toHaveBeenCalledWith(2160);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({ granularity: 'hourly', data: mockHourly })
			);
		});

		// The breakdown answers "which region", so it is scoped to recent hours
		// rather than to the chart range - a region fixed this morning should stop
		// being reported as broken even on the 90-day view.
		it('scopes the region breakdown to a day whatever the chart range', async () => {
			mockRepository.repository.getTorBoxCdnDailyHistory.mockResolvedValue([{ time: 'x' }]);
			const res = createMockResponse();

			await handler(
				createMockRequest({ method: 'GET', query: { type: 'torbox-cdn', range: '90d' } }),
				res
			);

			expect(mockRepository.repository.getTorBoxCdnRegionSummary).toHaveBeenCalledWith(24);
		});
	});

	it('returns 400 for invalid type', async () => {
		const req = createMockRequest({ method: 'GET', query: { type: 'invalid' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Invalid type parameter' });
	});

	it('returns 500 on repository error', async () => {
		mockRepository.repository.getStreamHourlyHistory.mockRejectedValue(new Error('DB down'));
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
	});

	it('handles unknown range by defaulting to 24h hourly', async () => {
		const mockData = [{ hour: '2024-01-01T00:00:00Z', count: 1 }];
		mockRepository.repository.getStreamHourlyHistory.mockResolvedValue(mockData);
		const req = createMockRequest({
			method: 'GET',
			query: { type: 'stream', range: 'unknown' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.repository.getStreamHourlyHistory).toHaveBeenCalledWith(24);
	});
});
