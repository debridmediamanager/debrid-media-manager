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
