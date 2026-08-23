import { render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TorBoxObservabilityStats } from '@/lib/observability/getTorBoxObservabilityStats';
import TorBoxStatusPage from '@/pages/is-torbox-down-or-just-me';
import { TORBOX_REFERRAL_URL } from '@/utils/referrals';

vi.mock('@/components/observability/TorBoxHistoryCharts', () => ({
	TorBoxHistoryCharts: () => <div data-testid="torbox-history-charts" />,
}));

const NOW = new Date('2026-08-23T12:00:00Z').getTime();

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
					authState: 'ok',
					authError: null,
					totalNodes: 2,
					workingNodes: 2,
					checkedAt: NOW - 60_000,
				},
			],
		},
		auth: { state: 'ok', error: null },
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

	// A rejected key is a problem with our monitoring credentials. It must never
	// tell every visitor that TorBox is down.
	it('keeps the verdict operational when only our API key is rejected', async () => {
		const stats = buildStats({
			auth: { state: 'credentials', error: 'AUTH_ERROR: Bad key' },
		});
		setMockFetch(stats);

		const { getByTestId } = render(<TorBoxStatusPage />);

		await waitFor(() => expect(getByTestId('status-answer')).toHaveTextContent('Operational'));
		const authCard = getByTestId('auth-card');
		expect(within(authCard).getByTestId('auth-state')).toHaveTextContent('Key rejected');
		expect(authCard).toHaveTextContent('not a TorBox outage');
	});

	it('reports an unmeasured authenticated surface without alarm', async () => {
		setMockFetch(buildStats({ auth: { state: 'skipped', error: null } }));

		const { getByTestId } = render(<TorBoxStatusPage />);

		await waitFor(() => expect(getByTestId('auth-state')).toHaveTextContent('Not measured'));
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
