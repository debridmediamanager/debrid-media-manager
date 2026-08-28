import {
	regionLabel,
	runCdnProbe,
	submitCdnProbe,
	type TorBoxCdnNodeResult,
} from '@/lib/observability/torboxCdnProbe';
import { AlertTriangle, Loader2, RefreshCw, Server } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

// The probe runs in the reader's browser, so it must never run on a timer: the
// page refreshes its counters every minute, and a per-minute fan-out to every
// CDN node from every open tab is a load pattern DMM has no business creating.
// Once on mount, then only when the reader asks.

export function TorBoxCdnPanel() {
	const [nodes, setNodes] = useState<TorBoxCdnNodeResult[]>([]);
	const [discoveryError, setDiscoveryError] = useState<string | null>(null);
	const [testing, setTesting] = useState(true);
	const [checkedAt, setCheckedAt] = useState<number | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const test = useCallback(async () => {
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;

		setTesting(true);
		const result = await runCdnProbe(controller.signal);
		if (controller.signal.aborted) return;

		setNodes(result.nodes);
		setDiscoveryError(result.discoveryError);
		setCheckedAt(result.checkedAt);
		setTesting(false);

		// Contribute the run to the history chart below. Not awaited and not
		// abortable: the panel is already showing its answer, and a vote that
		// outlives a "Test again" click or a navigation is still a good vote.
		// An aborted run never gets here - the guard above returns first - so
		// only a complete measurement is ever submitted.
		void submitCdnProbe(result);
	}, []);

	useEffect(() => {
		test();
		return () => abortRef.current?.abort();
	}, [test]);

	const working = nodes.filter((node) => node.ok);
	const failed = nodes.filter((node) => !node.ok);
	const rate = nodes.length > 0 ? working.length / nodes.length : null;
	const ratePct = rate !== null ? Math.round(rate * 100) : null;

	const latencies = working
		.map((node) => node.latencyMs)
		.filter((latency): latency is number => latency !== null);
	const fastest = latencies.length > 0 ? Math.min(...latencies) : null;

	return (
		<div
			data-testid="cdn-card"
			className="rounded-xl border border-white/10 bg-white/5 p-6 md:col-span-2 lg:col-span-3"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="flex items-center gap-2 text-sm font-medium text-slate-300">
					<Server className="h-4 w-4" />
					CDN Nodes Serving Bytes To You
				</h3>
				<button
					onClick={() => test()}
					disabled={testing}
					data-testid="cdn-retest"
					className="flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
					title="Test the CDN nodes again from your browser"
				>
					{testing ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
					) : (
						<RefreshCw className="h-3.5 w-3.5" />
					)}
					<span>{testing ? 'Testing...' : 'Test again'}</span>
				</button>
			</div>

			<div className="mt-4">
				{testing && nodes.length === 0 && discoveryError === null ? (
					<p data-testid="cdn-testing" className="text-sm text-slate-400">
						Asking every TorBox CDN region for a byte...
					</p>
				) : discoveryError !== null ? (
					<div
						data-testid="cdn-discovery-error"
						className="flex items-start gap-2 text-sm text-amber-400"
					>
						<AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
						<span>
							Could not read TorBox&apos;s CDN node list from your browser (
							{discoveryError}). That is a result too: if the rest of this page says
							TorBox is fine, something between you and TorBox is not.
						</span>
					</div>
				) : (
					<>
						<div className="flex items-baseline gap-2">
							<span
								data-testid="cdn-rate"
								className={`text-3xl font-bold ${
									ratePct === null
										? 'text-slate-400'
										: rate !== null && rate >= 0.9
											? 'text-emerald-400'
											: rate !== null && rate >= 0.5
												? 'text-amber-400'
												: 'text-rose-500'
								}`}
							>
								{ratePct !== null ? `${ratePct}%` : '—'}
							</span>
							<span className="text-sm text-slate-500">
								{nodes.length > 0
									? `${working.length}/${nodes.length} regions`
									: 'no data yet'}
							</span>
						</div>

						{working.length > 0 && (
							<div className="mt-3 space-y-1.5">
								<div className="text-xs font-medium text-emerald-400">
									Serving ({working.length})
								</div>
								<div className="flex flex-wrap gap-1">
									{working.map((node) => (
										<span
											key={node.host}
											className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs text-emerald-400"
											title={`${node.name} · ${node.host}`}
										>
											{regionLabel(node.region)}
											{node.closest && (
												<span className="ml-1 text-emerald-500/70">
													(nearest)
												</span>
											)}
											{node.latencyMs !== null && (
												<span className="ml-1 text-emerald-500/70">
													{Math.round(node.latencyMs)}ms
												</span>
											)}
										</span>
									))}
								</div>
							</div>
						)}

						{failed.length > 0 && (
							<div className="mt-3 space-y-1.5">
								<div className="text-xs font-medium text-rose-400">
									Not serving ({failed.length})
								</div>
								<div className="flex flex-wrap gap-1">
									{failed.map((node) => (
										<span
											key={node.host}
											className="rounded bg-rose-500/20 px-1.5 py-0.5 text-xs text-rose-400"
											title={`${node.host}${node.error ? ` · ${node.error}` : ''}`}
										>
											{regionLabel(node.region)}
										</span>
									))}
								</div>
							</div>
						)}

						{nodes.length > 0 && (
							<div className="mt-3 text-xs text-slate-500">
								Your browser asked each region for the first byte of its 100MB test
								file. A region only passes on an HTTP 206 — a node that answers the
								API but not a Range request is not serving data.
								{fastest !== null &&
									` Fastest region: ${Math.round(fastest)}ms.`}{' '}
								These are your latencies from your network, not ours, so a region
								failing here while the rest of this page reads healthy points at
								your route to TorBox rather than at TorBox. TorBox spreads its nodes
								over several domains, so a whole group failing together is usually
								DNS or ISP filtering on your side.
								{checkedAt !== null && (
									<span className="ml-1 text-slate-600">
										Tested{' '}
										{new Date(checkedAt).toLocaleTimeString('en-US', {
											hour: '2-digit',
											minute: '2-digit',
											second: '2-digit',
										})}
										.
									</span>
								)}
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}
