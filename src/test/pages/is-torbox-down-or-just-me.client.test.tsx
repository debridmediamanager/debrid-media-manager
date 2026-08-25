import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TorBoxObservabilityStats } from '@/lib/observability/getTorBoxObservabilityStats';
import TorBoxStatusPage from '@/pages/is-torbox-down-or-just-me';
import type { TorBoxOverallStats } from '@/services/database/torboxOperational';
import { TORBOX_REFERRAL_URL } from '@/utils/referrals';

vi.mock('@/components/observability/TorBoxHistoryCharts', () => ({
	TorBoxHistoryCharts: () => <div data-testid="torbox-history-charts" />,
}));

const NOW = new Date('2026-08-23T12:00:00Z').getTime();

function buildTbApiStats(overrides: Partial<TorBoxOverallStats> = {}): TorBoxOverallStats {
	const byOperation = {
		'GET /torrents/mylist': {
			operation: 'GET /torrents/mylist' as const,
			totalCount: 80,
			successCount: 78,
			failureCount: 2,
			successRate: 78 / 80,
		},
		'GET /torrents/checkcached': {
			operation: 'GET /torrents/checkcached' as const,
			totalCount: 20,
			successCount: 20,
			failureCount: 0,
			successRate: 1,
		},
	} as TorBoxOverallStats['byOperation'];

	return {
		totalCount: 100,
		successCount: 98,
		failureCount: 2,
		successRate: 0.98,
		isDown: false,
		byOperation,
		lastHour: new Date(NOW),
		...overrides,
	};
}

function buildStats(overrides: Partial<TorBoxObservabilityStats> = {}): TorBoxObservabilityStats {
	return {
		tbApi: buildTbApiStats(),
		windowHours: 2,
		lastChecked: NOW - 60_000,
		...overrides,
	};
}

type GlobalWithFetch = typeof globalThis & { fetch?: typeof fetch };
const globalWithFetch = globalThis as GlobalWithFetch;
const originalFetch = globalWithFetch.fetch;

function setMockFetch(stats: TorBoxObservabilityStats | null, ok = true) {
	globalWithFetch.fetch = vi.fn().mockResolvedValue({
		ok,
		status: ok ? 200 : 500,
		json: () => Promise.resolve(stats),
	}) as unknown as typeof fetch;
}

describe('TorBoxStatusPage', () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(NOW);
		setMockFetch(buildStats());
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		if (originalFetch) {
			globalWithFetch.fetch = originalFetch;
		} else {
			Reflect.deleteProperty(globalWithFetch, 'fetch');
		}
	});

	it('renders the operational verdict from real user traffic', async () => {
		const { getByTestId } = render(<TorBoxStatusPage />);

		await waitFor(() => expect(getByTestId('status-answer')).toHaveTextContent('Operational'));
		expect(getByTestId('tb-api-rate')).toHaveTextContent('98%');
		expect(getByTestId('volume-card')).toHaveTextContent('100');
	});

	// The page used to run its own probe of api.torbox.app and let it decide the
	// verdict. TorBox rate-limits that single datacentre IP - measured 2026-08-25
	// at 5/12 pings answering HTTP 429 while real users were at 96% - so the page
	// announced a major outage that no user was experiencing.
	describe('no synthetic probing', () => {
		it('renders no card fed by a probe of our own', async () => {
			const { queryByTestId, getByTestId } = render(<TorBoxStatusPage />);

			await waitFor(() => expect(getByTestId('tb-api-card')).toBeInTheDocument());
			expect(queryByTestId('cdn-card')).toBeNull();
			expect(queryByTestId('api-card')).toBeNull();
			expect(queryByTestId('service-card')).toBeNull();
			expect(queryByTestId('auth-card')).toBeNull();
		});

		it('asks only the DMM observability endpoint, never TorBox', async () => {
			render(<TorBoxStatusPage />);

			await waitFor(() => expect(globalWithFetch.fetch).toHaveBeenCalled());
			const urls = vi
				.mocked(globalWithFetch.fetch as unknown as ReturnType<typeof vi.fn>)
				.mock.calls.map((call) => String(call[0]));
			expect(urls.length).toBeGreaterThan(0);
			for (const url of urls) {
				expect(url).toContain('/api/observability/torbox');
				expect(url).not.toContain('torbox.app');
				expect(url).not.toContain('tb-cdn');
			}
		});
	});

	describe('user API success rate', () => {
		it('reports the rate measured from real DMM users', async () => {
			const { getByTestId } = render(<TorBoxStatusPage />);

			await waitFor(() => expect(getByTestId('tb-api-card')).toBeInTheDocument());
			expect(getByTestId('tb-api-rate')).toHaveTextContent('98%');
			expect(getByTestId('tb-api-card')).toHaveTextContent('98 of 100');
		});

		it('labels the card with the window the server actually used', async () => {
			setMockFetch(buildStats({ windowHours: 2 }));

			const { getByTestId } = render(<TorBoxStatusPage />);

			await waitFor(() => expect(getByTestId('tb-api-card')).toBeInTheDocument());
			expect(getByTestId('tb-api-card')).toHaveTextContent('User API Success Rate (2h)');
		});

		it('breaks the rate down per operation, busiest first', async () => {
			const { getByTestId } = render(<TorBoxStatusPage />);

			await waitFor(() => expect(getByTestId('tb-api-card')).toBeInTheDocument());
			const card = getByTestId('tb-api-card');
			expect(card).toHaveTextContent('/torrents/mylist');
			expect(card).toHaveTextContent('/torrents/checkcached');
			expect(card).toHaveTextContent('2 err');

			const rendered = card.textContent ?? '';
			expect(rendered.indexOf('/torrents/mylist')).toBeLessThan(
				rendered.indexOf('/torrents/checkcached')
			);
		});

		it('shows a placeholder before any user traffic has been recorded', async () => {
			setMockFetch(
				buildStats({
					tbApi: buildTbApiStats({
						totalCount: 0,
						successCount: 0,
						failureCount: 0,
						successRate: 0,
						byOperation: {} as TorBoxOverallStats['byOperation'],
					}),
				})
			);

			const { getByTestId } = render(<TorBoxStatusPage />);

			await waitFor(() => expect(getByTestId('tb-api-card')).toBeInTheDocument());
			expect(getByTestId('tb-api-rate')).toHaveTextContent('—');
			expect(getByTestId('tb-api-card')).toHaveTextContent('no data yet');
		});

		it('renders when the payload carries no user traffic section at all', async () => {
			setMockFetch(buildStats({ tbApi: null }));

			const { getByTestId } = render(<TorBoxStatusPage />);

			await waitFor(() => expect(getByTestId('tb-api-card')).toBeInTheDocument());
			expect(getByTestId('tb-api-rate')).toHaveTextContent('—');
			expect(getByTestId('status-answer')).toHaveTextContent('Collecting data');
		});

		// Only 2xx and 5xx are counted. The gap between the two totals is 4xx -
		// a caller's own bad key, which says nothing about whether TorBox is up.
		it('excludes 4xx answers from the denominator and says so', async () => {
			setMockFetch(
				buildStats({
					tbApi: buildTbApiStats({
						totalCount: 500,
						successCount: 98,
						failureCount: 2,
						successRate: 0.98,
					}),
				})
			);

			const { getByTestId } = render(<TorBoxStatusPage />);

			await waitFor(() => expect(getByTestId('tb-api-card')).toBeInTheDocument());
			expect(getByTestId('tb-api-card')).toHaveTextContent('98 of 100');
			expect(getByTestId('volume-card')).toHaveTextContent('400');
			expect(getByTestId('volume-card')).toHaveTextContent('excluded');
		});
	});

	describe('the verdict', () => {
		it('calls a run of user 5xx degraded', async () => {
			setMockFetch(
				buildStats({
					tbApi: buildTbApiStats({
						totalCount: 100,
						successCount: 70,
						failureCount: 30,
						successRate: 0.7,
					}),
				})
			);

			const { getByTestId } = render(<TorBoxStatusPage />);

			await waitFor(() =>
				expect(getByTestId('status-answer')).toHaveTextContent('Partial Outage')
			);
		});

		it('calls it down when most user calls fail', async () => {
			setMockFetch(
				buildStats({
					tbApi: buildTbApiStats({
						totalCount: 100,
						successCount: 10,
						failureCount: 90,
						successRate: 0.1,
						isDown: true,
					}),
				})
			);

			const { getByTestId } = render(<TorBoxStatusPage />);

			await waitFor(() =>
				expect(getByTestId('status-answer')).toHaveTextContent('Major Outage')
			);
			expect(getByTestId('tb-api-rate')).toHaveTextContent('10%');
		});

		// Without a fixed-cadence probe there is no sample-size floor of its own,
		// so a quiet night could otherwise read as a total outage off two calls.
		it('refuses to call it either way on too small a sample', async () => {
			setMockFetch(
				buildStats({
					tbApi: buildTbApiStats({
						totalCount: 2,
						successCount: 0,
						failureCount: 2,
						successRate: 0,
						isDown: true,
					}),
				})
			);

			const { getByTestId } = render(<TorBoxStatusPage />);

			await waitFor(() =>
				expect(getByTestId('status-answer')).toHaveTextContent('Collecting data')
			);
			expect(getByTestId('volume-card')).toHaveTextContent('floor');
		});
	});

	describe('freshness', () => {
		// Counters are bucketed by the hour, so a bucket start is routinely tens
		// of minutes old while traffic is flowing. Warning at 15m would fire
		// almost permanently.
		it('does not warn while an hour bucket is merely mid-flight', async () => {
			setMockFetch(buildStats({ lastChecked: NOW - 50 * 60 * 1000 }));

			const { queryByTestId, getByTestId } = render(<TorBoxStatusPage />);

			await waitFor(() => expect(getByTestId('status-freshness')).toBeInTheDocument());
			expect(queryByTestId('stale-banner')).toBeNull();
		});

		it('warns once a whole bucket has gone by with no recorded call', async () => {
			setMockFetch(buildStats({ lastChecked: NOW - 3 * 60 * 60 * 1000 }));

			const { getByTestId } = render(<TorBoxStatusPage />);

			await waitFor(() => expect(getByTestId('stale-banner')).toBeInTheDocument());
			expect(getByTestId('stale-banner')).toHaveTextContent(
				'No TorBox call has been recorded'
			);
		});

		it('reports its own load time rather than a stored check time', async () => {
			const { getByTestId } = render(<TorBoxStatusPage />);

			await waitFor(() =>
				expect(getByTestId('status-freshness')).toHaveTextContent('Updated')
			);
		});
	});

	it('keeps the last good payload when a refresh fails', async () => {
		const { getByTestId } = render(<TorBoxStatusPage />);
		await waitFor(() => expect(getByTestId('status-answer')).toHaveTextContent('Operational'));

		setMockFetch(null, false);
		await vi.advanceTimersByTimeAsync(60_000);

		await waitFor(() => expect(getByTestId('stale-banner')).toBeInTheDocument());
		expect(getByTestId('status-answer')).toHaveTextContent('Operational');
		expect(getByTestId('stale-banner')).toHaveTextContent('Could not reach the status API');
	});

	// The referral id is what makes the sign-up link earn anything, so assert the
	// whole URL rather than just that some link exists.
	it('links to TorBox sign-up with the referral id', async () => {
		const { findByText } = render(<TorBoxStatusPage />);

		const link = await findByText('Sign up for TorBox');
		expect(link).toHaveAttribute('href', TORBOX_REFERRAL_URL);
		expect(TORBOX_REFERRAL_URL).toContain('referral=74ffa560-7381-4a18-adb1-cef97378c670');
		expect(link).toHaveAttribute('target', '_blank');
		expect(link).toHaveAttribute('rel', 'noopener noreferrer');
	});

	it('ignores a payload that is not TorBox stats', async () => {
		setMockFetch({ nonsense: true } as unknown as TorBoxObservabilityStats);

		const { queryByTestId } = render(<TorBoxStatusPage />);

		await waitFor(() => expect(queryByTestId('status-answer')).toBeNull());
	});
});
