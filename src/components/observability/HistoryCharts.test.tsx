import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('recharts', () => {
	const Original = vi.importActual('recharts');
	return {
		...Original,
		ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
			<div data-testid="responsive-container">{children}</div>
		),
		AreaChart: ({ children }: { children: React.ReactNode }) => (
			<div data-testid="area-chart">{children}</div>
		),
		Area: () => <div data-testid="area" />,
		CartesianGrid: () => <div />,
		XAxis: () => <div />,
		YAxis: () => <div />,
		Tooltip: () => <div />,
	};
});

import { HistoryCharts } from './HistoryCharts';

const mockStreamHourly = {
	type: 'stream',
	granularity: 'hourly',
	range: '24h',
	data: [
		{
			hour: '2024-01-01T10:00:00Z',
			totalServers: 5,
			workingServers: 4,
			workingRate: 0.8,
			avgLatencyMs: 100,
		},
		{
			hour: '2024-01-01T11:00:00Z',
			totalServers: 5,
			workingServers: 5,
			workingRate: 1.0,
			avgLatencyMs: 90,
		},
	],
};

const mockRdHourly = {
	type: 'rd',
	granularity: 'hourly',
	range: '24h',
	data: [
		{
			hour: '2024-01-01T10:00:00Z',
			totalCount: 100,
			successCount: 95,
			failureCount: 5,
			successRate: 0.95,
		},
	],
};

const mockTorrentioHourly = {
	type: 'torrentio',
	granularity: 'hourly',
	range: '24h',
	data: [
		{
			hour: '2024-01-01T10:00:00Z',
			successCount: 90,
			totalCount: 100,
			successRate: 0.9,
			avgLatencyMs: 200,
		},
	],
};

const emptyResponse = { type: 'stream', granularity: 'hourly', range: '24h', data: [] };

function mockFetchResponses(stream: object, rd: object | null, torrentio: object | null) {
	const fetchMock = vi.fn();
	fetchMock.mockImplementation((url: string) => {
		if (url.includes('type=stream')) {
			return Promise.resolve({ ok: true, json: () => Promise.resolve(stream) });
		}
		if (url.includes('type=rd')) {
			if (!rd) return Promise.resolve({ ok: false });
			return Promise.resolve({ ok: true, json: () => Promise.resolve(rd) });
		}
		if (url.includes('type=torrentio')) {
			if (!torrentio) return Promise.resolve({ ok: false });
			return Promise.resolve({ ok: true, json: () => Promise.resolve(torrentio) });
		}
		return Promise.resolve({ ok: false });
	});
	global.fetch = fetchMock;
	return fetchMock;
}

describe('HistoryCharts', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('shows loading state initially', () => {
		mockFetchResponses(mockStreamHourly, mockRdHourly, mockTorrentioHourly);
		// Never resolve to keep loading
		global.fetch = vi.fn(() => new Promise(() => {})) as any;
		render(<HistoryCharts />);
		expect(screen.getByText('Loading history...')).toBeInTheDocument();
	});

	it('renders all three charts when data is available', async () => {
		mockFetchResponses(mockStreamHourly, mockRdHourly, mockTorrentioHourly);
		render(<HistoryCharts />);

		await waitFor(() => {
			expect(screen.getByText('Stream Server Health')).toBeInTheDocument();
		});
		expect(screen.getByText('API Success Rate')).toBeInTheDocument();
		expect(screen.getByText('Torrentio Resolver Health')).toBeInTheDocument();
	});

	it('renders empty state when all data arrays are empty', async () => {
		mockFetchResponses(emptyResponse, emptyResponse, emptyResponse);
		render(<HistoryCharts />);

		await waitFor(() => {
			expect(screen.getByText('No historical data available yet')).toBeInTheDocument();
		});
	});

	it('renders error state and retry button on fetch failure', async () => {
		global.fetch = vi.fn().mockImplementation((url: string) => {
			if (url.includes('type=stream')) {
				return Promise.resolve({ ok: false });
			}
			return Promise.resolve({ ok: false });
		});

		render(<HistoryCharts />);

		await waitFor(() => {
			expect(screen.getByText('Unable to load historical data')).toBeInTheDocument();
		});
		expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
	});

	it('renders only stream chart when rd and torrentio fail', async () => {
		mockFetchResponses(mockStreamHourly, null, null);
		render(<HistoryCharts />);

		await waitFor(() => {
			expect(screen.getByText('Stream Server Health')).toBeInTheDocument();
		});
		expect(screen.queryByText('API Success Rate')).not.toBeInTheDocument();
		expect(screen.queryByText('Torrentio Resolver Health')).not.toBeInTheDocument();
	});

	it('switches range when a range button is clicked', async () => {
		const fetchMock = mockFetchResponses(mockStreamHourly, mockRdHourly, mockTorrentioHourly);
		render(<HistoryCharts />);

		await waitFor(() => {
			expect(screen.getByText('Stream Server Health')).toBeInTheDocument();
		});

		fetchMock.mockClear();
		const dailyStream = { ...mockStreamHourly, granularity: 'daily', range: '7d' };
		mockFetchResponses(dailyStream, mockRdHourly, mockTorrentioHourly);

		await userEvent.click(screen.getByRole('button', { name: '7 Days' }));

		await waitFor(() => {
			expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('range=7d'));
		});
	});

	it('displays the correct granularity label', async () => {
		const dailyStream = { ...mockStreamHourly, granularity: 'daily', range: '30d' };
		mockFetchResponses(dailyStream, emptyResponse, emptyResponse);
		render(<HistoryCharts />);

		await waitFor(() => {
			expect(screen.getByText(/Daily aggregates/)).toBeInTheDocument();
		});
	});

	it('retries on error when retry button is clicked', async () => {
		let callCount = 0;
		global.fetch = vi.fn().mockImplementation((url: string) => {
			callCount++;
			if (callCount <= 3) {
				if (url.includes('type=stream')) {
					return Promise.resolve({ ok: false });
				}
				return Promise.resolve({ ok: false });
			}
			return mockFetchResponses(mockStreamHourly, mockRdHourly, mockTorrentioHourly)(url);
		});

		render(<HistoryCharts />);

		await waitFor(() => {
			expect(screen.getByText('Unable to load historical data')).toBeInTheDocument();
		});

		mockFetchResponses(mockStreamHourly, mockRdHourly, mockTorrentioHourly);
		await userEvent.click(screen.getByRole('button', { name: /Retry/i }));

		await waitFor(() => {
			expect(screen.getByText('Stream Server Health')).toBeInTheDocument();
		});
	});
});
