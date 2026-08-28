import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('recharts', () => ({
	ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="responsive-container">{children}</div>
	),
	AreaChart: ({ children, data }: { children: React.ReactNode; data: unknown[] }) => (
		<div data-testid="area-chart" data-points={JSON.stringify(data)}>
			{children}
		</div>
	),
	Area: () => <div data-testid="area" />,
	CartesianGrid: () => <div />,
	XAxis: () => <div />,
	YAxis: () => <div />,
	Tooltip: () => <div />,
}));

import { TorBoxHistoryCharts } from './TorBoxHistoryCharts';

const API_PAYLOAD = {
	type: 'torbox-api',
	granularity: 'hourly',
	range: '24h',
	data: [
		{
			hour: '2026-08-28T12:00:00Z',
			totalCount: 500,
			successCount: 495,
			failureCount: 5,
			successRate: 0.99,
		},
	],
};

function cdnPayload(overrides: Record<string, unknown> = {}) {
	return {
		type: 'torbox-cdn',
		granularity: 'hourly',
		range: '24h',
		data: [
			{
				time: '2026-08-28T12:00:00Z',
				okCount: 130,
				failCount: 40,
				rate: 130 / 170,
				avgLatencyMs: 220,
			},
		],
		regions: [
			{ region: 'enam', okCount: 0, failCount: 40, rate: 0, avgLatencyMs: null },
			{ region: 'ceur', okCount: 130, failCount: 0, rate: 1, avgLatencyMs: 42.4 },
		],
		regionWindowHours: 24,
		...overrides,
	};
}

type GlobalWithFetch = typeof globalThis & { fetch?: typeof fetch };
const globalWithFetch = globalThis as GlobalWithFetch;
const originalFetch = globalWithFetch.fetch;

function mockFetch(options: { api?: unknown; cdn?: unknown; cdnOk?: boolean } = {}) {
	globalWithFetch.fetch = vi.fn().mockImplementation((url: string) => {
		if (url.includes('type=torbox-cdn')) {
			return Promise.resolve({
				ok: options.cdnOk ?? true,
				status: (options.cdnOk ?? true) ? 200 : 400,
				json: () => Promise.resolve(options.cdn ?? cdnPayload()),
			});
		}
		return Promise.resolve({
			ok: true,
			status: 200,
			json: () => Promise.resolve(options.api ?? API_PAYLOAD),
		});
	}) as unknown as typeof fetch;
}

beforeEach(() => {
	mockFetch();
});

afterEach(() => {
	vi.clearAllMocks();
	if (originalFetch) {
		globalWithFetch.fetch = originalFetch;
	} else {
		Reflect.deleteProperty(globalWithFetch, 'fetch');
	}
});

describe('TorBoxHistoryCharts', () => {
	it('charts the crowd-sourced CDN series alongside the API one', async () => {
		render(<TorBoxHistoryCharts />);

		const cdnChart = await screen.findByTestId('torbox-cdn-chart');
		expect(cdnChart).toHaveTextContent('CDN Regions Serving Bytes');
		expect(screen.getByTestId('torbox-user-api-chart')).toBeInTheDocument();
	});

	it('names the reader browser as the source, not a probe of ours', async () => {
		render(<TorBoxHistoryCharts />);

		const cdnChart = await screen.findByTestId('torbox-cdn-chart');
		expect(cdnChart).toHaveTextContent(/visitors' own browsers/i);
	});

	it('lists the worst region first with its rate and latency', async () => {
		render(<TorBoxHistoryCharts />);

		const cdnChart = await screen.findByTestId('torbox-cdn-chart');
		expect(cdnChart).toHaveTextContent('Eastern North America');
		expect(cdnChart).toHaveTextContent('Central Europe');
		expect(cdnChart).toHaveTextContent('42ms');
		expect(cdnChart).toHaveTextContent('By region, last 24h');
	});

	// A region collects one vote per visitor over a whole day, so holding it to
	// the hourly floor left every region reading "3 checks" on a quiet day.
	it('reports a region rate once it has enough votes of its own', async () => {
		mockFetch({
			cdn: cdnPayload({
				regions: [
					{ region: 'ceur', okCount: 12, failCount: 0, rate: 1, avgLatencyMs: 40 },
					{ region: 'apac', okCount: 1, failCount: 0, rate: 1, avgLatencyMs: 800 },
					{ region: 'japn', okCount: 3, failCount: 0, rate: 1, avgLatencyMs: 900 },
				],
			}),
		});

		render(<TorBoxHistoryCharts />);

		const cdnChart = await screen.findByTestId('torbox-cdn-chart');
		expect(cdnChart).toHaveTextContent('100%');
		expect(cdnChart).toHaveTextContent('1 check');
		expect(cdnChart).toHaveTextContent('3 checks');
	});

	// One visitor behind a DNS block must not read as a global CDN outage, so a
	// bucket under the floor is left out of the line rather than plotted at 0%.
	it('drops a bucket that has too few region checks to mean anything', async () => {
		mockFetch({
			cdn: cdnPayload({
				data: [
					{
						time: '2026-08-28T11:00:00Z',
						okCount: 0,
						failCount: 4,
						rate: 0,
						avgLatencyMs: null,
					},
					{
						time: '2026-08-28T12:00:00Z',
						okCount: 130,
						failCount: 40,
						rate: 130 / 170,
						avgLatencyMs: 220,
					},
				],
			}),
		});

		render(<TorBoxHistoryCharts />);

		await screen.findByTestId('torbox-cdn-chart');
		const charts = screen.getAllByTestId('area-chart');
		const cdnPoints = charts
			.map((chart) => JSON.parse(chart.getAttribute('data-points') ?? '[]'))
			.find((points) => points.some((p: { sampleCount?: number }) => 'sampleCount' in p));

		expect(cdnPoints).toHaveLength(2);
		expect(cdnPoints[0].rate).toBeNull();
		expect(cdnPoints[1].rate).toBeCloseTo(130 / 170);
	});

	it('explains the floor rather than drawing an empty chart', async () => {
		mockFetch({
			cdn: cdnPayload({
				data: [
					{
						time: '2026-08-28T12:00:00Z',
						okCount: 1,
						failCount: 0,
						rate: 1,
						avgLatencyMs: 10,
					},
				],
				regions: [],
			}),
		});

		render(<TorBoxHistoryCharts />);

		expect(await screen.findByTestId('torbox-cdn-empty')).toHaveTextContent(
			/Not enough visitor checks yet/
		);
	});

	// The CDN route is the newer of the two, so a deployment that predates it
	// must still render the page rather than fail it.
	it('renders the API charts when the CDN route is unavailable', async () => {
		mockFetch({ cdnOk: false });

		render(<TorBoxHistoryCharts />);

		expect(await screen.findByTestId('torbox-user-api-chart')).toBeInTheDocument();
		expect(screen.getByTestId('torbox-cdn-empty')).toBeInTheDocument();
		expect(screen.queryByText('Unable to load historical data')).toBeNull();
	});

	it('shows the CDN chart even when no user API traffic was recorded', async () => {
		mockFetch({ api: { ...API_PAYLOAD, data: [] } });

		render(<TorBoxHistoryCharts />);

		expect(await screen.findByTestId('torbox-cdn-chart')).toBeInTheDocument();
		expect(screen.queryByTestId('torbox-user-api-chart')).toBeNull();
	});

	it('falls back to the shared empty state when neither series has data', async () => {
		mockFetch({
			api: { ...API_PAYLOAD, data: [] },
			cdn: cdnPayload({ data: [], regions: [] }),
		});

		render(<TorBoxHistoryCharts />);

		await waitFor(() =>
			expect(screen.getByText('No historical data available yet')).toBeInTheDocument()
		);
		expect(screen.queryByTestId('torbox-cdn-chart')).toBeNull();
	});
});
