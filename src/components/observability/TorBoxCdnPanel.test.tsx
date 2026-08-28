import { TorBoxCdnPanel } from '@/components/observability/TorBoxCdnPanel';
import type { TorBoxCdnNodeResult, TorBoxCdnProbeResult } from '@/lib/observability/torboxCdnProbe';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runCdnProbe = vi.fn();

vi.mock('@/lib/observability/torboxCdnProbe', async () => {
	const actual = await vi.importActual<typeof import('@/lib/observability/torboxCdnProbe')>(
		'@/lib/observability/torboxCdnProbe'
	);
	return { ...actual, runCdnProbe: (...args: unknown[]) => runCdnProbe(...args) };
});

function nodeResult(overrides: Partial<TorBoxCdnNodeResult> = {}): TorBoxCdnNodeResult {
	return {
		host: 'nexus-067.ceur.tb-cdn.st',
		region: 'ceur',
		name: 'nexus-067',
		url: 'https://nexus-067.ceur.tb-cdn.st/dld/100MB.bin',
		closest: true,
		ok: true,
		status: 206,
		latencyMs: 42.4,
		error: null,
		...overrides,
	};
}

function probeResult(overrides: Partial<TorBoxCdnProbeResult> = {}): TorBoxCdnProbeResult {
	return { nodes: [nodeResult()], discoveryError: null, checkedAt: Date.now(), ...overrides };
}

beforeEach(() => {
	runCdnProbe.mockResolvedValue(probeResult());
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('TorBoxCdnPanel', () => {
	it('probes once on mount and reports the share of regions serving bytes', async () => {
		render(<TorBoxCdnPanel />);

		expect(await screen.findByTestId('cdn-rate')).toHaveTextContent('100%');
		expect(screen.getByText('1/1 regions')).toBeInTheDocument();
		const badge = screen.getByTitle('nexus-067 · nexus-067.ceur.tb-cdn.st');
		expect(badge).toHaveTextContent('Central Europe');
		expect(badge).toHaveTextContent('(nearest)');
		expect(badge).toHaveTextContent('42ms');
		expect(runCdnProbe).toHaveBeenCalledTimes(1);
	});

	it('splits serving from not-serving regions', async () => {
		runCdnProbe.mockResolvedValue(
			probeResult({
				nodes: [
					nodeResult(),
					nodeResult({
						host: 'nexus-087.enam.tb-cdn.io',
						region: 'enam',
						closest: false,
						ok: false,
						status: 502,
						latencyMs: null,
						error: 'HTTP 502',
					}),
				],
			})
		);

		render(<TorBoxCdnPanel />);

		expect(await screen.findByTestId('cdn-rate')).toHaveTextContent('50%');
		expect(screen.getByText('Serving (1)')).toBeInTheDocument();
		expect(screen.getByText('Not serving (1)')).toBeInTheDocument();
		expect(screen.getByText('Eastern North America')).toHaveAttribute(
			'title',
			'nexus-087.enam.tb-cdn.io · HTTP 502'
		);
	});

	it('re-probes when the reader asks, and never on a timer', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		try {
			render(<TorBoxCdnPanel />);
			await waitFor(() => expect(runCdnProbe).toHaveBeenCalledTimes(1));

			// The page refreshes its counters every minute; fanning out to every CDN
			// node on that cadence, from every open tab, is load DMM must not create.
			vi.advanceTimersByTime(10 * 60_000);
			expect(runCdnProbe).toHaveBeenCalledTimes(1);

			fireEvent.click(screen.getByTestId('cdn-retest'));
			await waitFor(() => expect(runCdnProbe).toHaveBeenCalledTimes(2));
		} finally {
			vi.useRealTimers();
		}
	});

	it('says so when TorBox will not even hand over the node list', async () => {
		runCdnProbe.mockResolvedValue(probeResult({ nodes: [], discoveryError: 'HTTP 429' }));

		render(<TorBoxCdnPanel />);

		expect(await screen.findByTestId('cdn-discovery-error')).toHaveTextContent('HTTP 429');
		expect(screen.queryByTestId('cdn-rate')).not.toBeInTheDocument();
	});

	it('aborts the in-flight probe when unmounted', async () => {
		let seenSignal: AbortSignal | undefined;
		runCdnProbe.mockImplementation((signal?: AbortSignal) => {
			seenSignal = signal;
			return new Promise<TorBoxCdnProbeResult>(() => {});
		});

		const { unmount } = render(<TorBoxCdnPanel />);
		await waitFor(() => expect(seenSignal).toBeDefined());
		unmount();

		expect(seenSignal?.aborted).toBe(true);
	});
});
