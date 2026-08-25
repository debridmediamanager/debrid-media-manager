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
		cdn: {
			total: 2,
			working: 2,
			rate: 1,
			lastChecked: NOW - 60_000,
			avgLatencyMs: 150,
			fastestNode: 'nexus-067.ceur.tb-cdn.st',
			inProgress: false,
			nodes: [
				{
					host: 'nexus-067.ceur.tb-cdn.st',
					region: 'ceur',
					name: 'nexus-067',
					latencyMs: 100,
					ok: true,
					error: null,
				},
				{
					host: 'nexus-115.japn.tb-cdn.pw',
					region: 'japn',
					name: 'nexus-115',
					latencyMs: 200,
					ok: true,
					error: null,
				},
			],
		},
		api: {
			ok: true,
			latencyMs: 42,
			detail: 'API is running.',
			successCount: 3,
			totalCount: 3,
			successRate: 1,
			recentChecks: [
				{
					apiOk: true,
					apiLatencyMs: 42,
					apiDetail: 'API is running.',
					totalNodes: 2,
					workingNodes: 2,
					checkedAt: NOW - 60_000,
				},
			],
		},
		tbApi: buildTbApiStats(),
		service: { totalUsers: 944281, totalServers: 212 },
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

	it('renders the operational verdict with every card', async () => {
		const { getByTestId } = render(<TorBoxStatusPage />);

		await waitFor(() => expect(getByTestId('status-answer')).toHaveTextContent('Operational'));
		expect(getByTestId('cdn-card')).toHaveTextContent('100%');
		expect(getByTestId('cdn-card')).toHaveTextContent('2/2 regions');
		expect(getByTestId('api-card')).toHaveTextContent('Up');
		expect(getByTestId('service-card')).toHaveTextContent('212');
	});

	// This card is the whole point of the page mirroring /is-real-debrid-down-or-just-me:
	// what TorBox returned to real users, not to a synthetic prober.
	describe('user API success rate', () => {
		it('reports the rate measured from real DMM users', async () => {
			const { getByTestId } = render(<TorBoxStatusPage />);

			await waitFor(() => expect(getByTestId('tb-api-card')).toBeInTheDocument());
			expect(getByTestId('tb-api-rate')).toHaveTextContent('98%');
			expect(getByTestId('tb-api-card')).toHaveTextContent('98 of 100');
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
		});

		// A wave of user 5xx must not silently flip the headline verdict: that
		// stays derived from the unauthenticated probes, as on the RD page.
		it('does not let user traffic drive the headline verdict', async () => {
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
				expect(getByTestId('status-answer')).toHaveTextContent('Operational')
			);
			expect(getByTestId('tb-api-rate')).toHaveTextContent('10%');
		});
	});

	it('labels regions with readable names', async () => {
		const { getByTestId } = render(<TorBoxStatusPage />);

		await waitFor(() => expect(getByTestId('cdn-card')).toBeInTheDocument());
		expect(getByTestId('cdn-card')).toHaveTextContent('Central Europe');
		expect(getByTestId('cdn-card')).toHaveTextContent('Japan');
	});

	it('calls a partial CDN outage degraded, not down', async () => {
		const stats = buildStats();
		stats.cdn = {
			...stats.cdn,
			total: 4,
			working: 3,
			rate: 0.75,
			nodes: [
				...stats.cdn.nodes,
				{
					host: 'nexus-999.apac.tb-cdn.pw',
					region: 'apac',
					name: 'nexus-999',
					latencyMs: 300,
					ok: true,
					error: null,
				},
				{
					host: 'nexus-888.indi.tb-cdn.pw',
					region: 'indi',
					name: 'nexus-888',
					latencyMs: null,
					ok: false,
					error: 'Timeout',
				},
			],
		};
		setMockFetch(stats);

		const { getByTestId } = render(<TorBoxStatusPage />);

		await waitFor(() =>
			expect(getByTestId('status-answer')).toHaveTextContent('Partial Outage')
		);
		expect(getByTestId('cdn-card')).toHaveTextContent('Not serving (1)');
		expect(getByTestId('cdn-card')).toHaveTextContent('India');
	});

	it('calls it down when most regions stop serving bytes', async () => {
		const stats = buildStats();
		stats.cdn = { ...stats.cdn, total: 4, working: 1, rate: 0.25 };
		setMockFetch(stats);

		const { getByTestId } = render(<TorBoxStatusPage />);

		await waitFor(() => expect(getByTestId('status-answer')).toHaveTextContent('Major Outage'));
	});

	it('calls it down when the API root stops answering', async () => {
		const stats = buildStats();
		stats.api = { ...stats.api, ok: false, detail: 'ECONNREFUSED', latencyMs: null };
		setMockFetch(stats);

		const { getByTestId } = render(<TorBoxStatusPage />);

		await waitFor(() => expect(getByTestId('status-answer')).toHaveTextContent('Major Outage'));
		expect(getByTestId('api-card')).toHaveTextContent('Down');
	});

	// The authenticated panel was removed: it reported on our own monitoring key
	// rather than on TorBox, and never affected the verdict.
	it('no longer renders an authenticated-API panel', async () => {
		const { queryByTestId, getByTestId } = render(<TorBoxStatusPage />);

		await waitFor(() => expect(getByTestId('tb-api-card')).toBeInTheDocument());
		expect(queryByTestId('auth-card')).toBeNull();
		expect(queryByTestId('auth-state')).toBeNull();
	});

	it('shows a waiting state before any check has run', async () => {
		setMockFetch(
			buildStats({
				cdn: {
					total: 0,
					working: 0,
					rate: 0,
					lastChecked: null,
					avgLatencyMs: null,
					fastestNode: null,
					inProgress: false,
					nodes: [],
				},
				api: {
					ok: null,
					latencyMs: null,
					detail: null,
					successCount: 0,
					totalCount: 0,
					successRate: null,
					recentChecks: [],
				},
				lastChecked: null,
			})
		);

		const { getByTestId } = render(<TorBoxStatusPage />);

		await waitFor(() =>
			expect(getByTestId('status-answer')).toHaveTextContent('Collecting data')
		);
		expect(getByTestId('status-freshness')).toHaveTextContent('No check recorded yet');
	});

	// The freshness label comes from the stored check time, so a stalled cron is
	// visible instead of being masked by the browser's own fetch clock.
	it('warns when the stored checks have gone stale', async () => {
		setMockFetch(buildStats({ lastChecked: NOW - 45 * 60 * 1000 }));

		const { getByTestId } = render(<TorBoxStatusPage />);

		await waitFor(() => expect(getByTestId('stale-banner')).toBeInTheDocument());
		expect(getByTestId('stale-banner')).toHaveTextContent('stopped updating 45m ago');
		expect(getByTestId('status-freshness')).toHaveTextContent('Checked 45m ago');
	});

	it('does not warn while checks are current', async () => {
		const { queryByTestId, getByTestId } = render(<TorBoxStatusPage />);

		await waitFor(() => expect(getByTestId('status-freshness')).toBeInTheDocument());
		expect(queryByTestId('stale-banner')).toBeNull();
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
