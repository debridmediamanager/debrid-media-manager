import { useConnectivity } from '@/hooks/useConnectivity';
import type { RealDebridObservabilityStats } from '@/lib/observability/getRealDebridObservabilityStats';
import type { LucideIcon } from 'lucide-react';
import {
	Activity,
	AlertTriangle,
	CheckCircle2,
	Clock,
	Globe,
	Loader2,
	RefreshCw,
	Wifi,
	WifiOff,
} from 'lucide-react';
import type { NextPage } from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';

// Dynamic imports with ssr: false to avoid Recharts SSR compatibility issues
const HistoryCharts = dynamic(
	() => import('@/components/observability/HistoryCharts').then((mod) => mod.HistoryCharts),
	{ ssr: false }
);

const FIXED_LOCALE = 'en-US';

function formatDateTime(timestamp: number): string {
	return new Date(timestamp).toLocaleString(FIXED_LOCALE, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
}

type StatusState = 'idle' | 'up' | 'down';

function isRealDebridObservabilityPayload(value: unknown): value is RealDebridObservabilityStats {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	// Only need workingStream for stream health checks
	if (!candidate.workingStream || typeof candidate.workingStream !== 'object') {
		return false;
	}
	return true;
}

const RealDebridStatusPage: NextPage & { disableLibraryProvider?: boolean } = () => {
	const [stats, setStats] = useState<RealDebridObservabilityStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [lastChecked, setLastChecked] = useState<number>(Date.now());
	const isOnline = useConnectivity();

	const loadStats = async () => {
		try {
			const cacheBuster = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
			const params = new URLSearchParams({ _t: cacheBuster, verbose: 'true' });
			const origin = window.location.origin;
			const requestUrl = new URL('/api/observability/real-debrid', origin);
			requestUrl.search = params.toString();
			const response = await fetch(requestUrl.toString(), {
				cache: 'no-store',
			});
			if (!response.ok) {
				console.error('Real-Debrid stats fetch failed with status', response.status);
				return;
			}
			const payload: unknown = await response.json();
			if (!isRealDebridObservabilityPayload(payload)) {
				console.error('Received invalid Real-Debrid stats payload', payload);
				return;
			}
			setStats(payload);
			setLastChecked(Date.now());
		} catch (error) {
			console.error('Failed to fetch Real-Debrid stats', error);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		loadStats();
		const interval = setInterval(loadStats, 60000); // Auto-refresh every 60s
		return () => clearInterval(interval);
	}, []);

	const pageTitle = 'Is Real-Debrid Down Or Just Me?';
	const canonicalUrl = 'https://debridmediamanager.com/is-real-debrid-down-or-just-me';
	const defaultDescription =
		'Live Real-Debrid availability dashboard covering account, torrent, and unrestrict endpoints.';

	// Loading State
	if (loading || !stats) {
		return (
			<>
				<Head>
					<title>{pageTitle}</title>
					<link rel="canonical" href={canonicalUrl} />
					<meta name="description" content={defaultDescription} />
				</Head>
				<main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
					<div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-center gap-4 py-32">
						<Loader2 className="h-8 w-8 animate-spin text-slate-400" />
						<p className="text-slate-400">Checking Real-Debrid status...</p>
					</div>
				</main>
			</>
		);
	}

	// Stream Health Logic - determines overall status
	const workingStream = stats.workingStream;
	const workingServers = workingStream?.workingServers ?? [];
	const failedServers = workingStream?.failedServers ?? [];
	// Use the actual server rate (working/total) for status determination
	const streamPct = workingStream.total > 0 ? Math.round(workingStream.rate * 100) : null;

	// RD API Health
	const rdApi = stats.rdApi;
	const rdApiPct = rdApi && rdApi.totalCount > 0 ? Math.round(rdApi.successRate * 100) : null;
	const rdApiConsidered = rdApi ? rdApi.successCount + rdApi.failureCount : 0;

	// Torrentio Health
	const torrentio = stats.torrentio;
	const torrentioChecks = torrentio?.recentChecks ?? [];
	const torrentioPassedCount = torrentioChecks.filter((c) => c.ok).length;
	const torrentioTotalChecks = torrentioChecks.length;
	const torrentioPct =
		torrentioTotalChecks > 0
			? Math.round((torrentioPassedCount / torrentioTotalChecks) * 100)
			: null;

	// Determine status based on stream health (working servers / total servers)
	const state: StatusState =
		workingStream.total === 0 ? 'idle' : streamPct !== null && streamPct < 50 ? 'down' : 'up';

	const statusMeta: Record<
		StatusState,
		{
			label: string;
			description: string;
			colorClass: string;
			bgColorClass: string;
			borderColorClass: string;
			icon: LucideIcon;
		}
	> = {
		idle: {
			label: 'Waiting for data',
			description: 'Collecting initial samples...',
			colorClass: 'text-slate-400',
			bgColorClass: 'bg-slate-500/10',
			borderColorClass: 'border-slate-500/20',
			icon: Clock,
		},
		up: {
			label: 'Real-Debrid is Operational',
			description: 'Stream servers responding',
			colorClass: 'text-emerald-400',
			bgColorClass: 'bg-emerald-500/10',
			borderColorClass: 'border-emerald-500/20',
			icon: CheckCircle2,
		},
		down: {
			label: 'Real-Debrid is Down',
			description: 'Stream servers not responding',
			colorClass: 'text-rose-500',
			bgColorClass: 'bg-rose-500/10',
			borderColorClass: 'border-rose-500/20',
			icon: AlertTriangle,
		},
	};

	const currentStatus = statusMeta[state];

	return (
		<>
			<Head>
				<title>{pageTitle}</title>
				<link rel="canonical" href={canonicalUrl} />
				<meta name="description" content={defaultDescription} />
			</Head>

			<main className="min-h-screen bg-slate-950 text-slate-100">
				{/* Connectivity Banner */}
				{!isOnline && (
					<div className="bg-amber-500/10 px-4 py-2 text-center text-sm font-medium text-amber-500">
						<div className="mx-auto flex max-w-5xl items-center justify-center gap-2">
							<WifiOff className="h-4 w-4" />
							<span>You are offline. This status might not be up to date.</span>
						</div>
					</div>
				)}

				<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
					{/* Header / Hero */}
					<header className="flex flex-col items-center gap-6 pt-8 text-center">
						<div
							className={`flex items-center gap-3 rounded-full border px-6 py-2 ${currentStatus.bgColorClass} ${currentStatus.borderColorClass}`}
						>
							<div className={`relative flex h-3 w-3`}>
								<span
									className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${state === 'up' ? 'bg-emerald-400' : state === 'down' ? 'bg-rose-500' : 'bg-slate-400'}`}
								></span>
								<span
									className={`relative inline-flex h-3 w-3 rounded-full ${state === 'up' ? 'bg-emerald-500' : state === 'down' ? 'bg-rose-600' : 'bg-slate-500'}`}
								></span>
							</div>
							<span className={`font-semibold ${currentStatus.colorClass}`}>
								<span data-testid="status-answer-mobile">
									{state === 'up'
										? 'Operational'
										: state === 'down'
											? 'Major Outage'
											: ' collecting data'}
								</span>
							</span>
						</div>

						<h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
							{currentStatus.label}
						</h1>

						<p className="max-w-2xl text-lg text-slate-400">
							Live monitoring of Real-Debrid stream server availability.
						</p>

						<div className="flex items-center gap-4 text-xs font-medium text-slate-400">
							<div className="flex items-center gap-1.5">
								<Clock className="h-3.5 w-3.5" />
								<span data-testid="status-freshness">
									Last updated: {formatDateTime(lastChecked)}
								</span>
							</div>
							<button
								onClick={() => loadStats()}
								className="flex items-center gap-1.5 transition-colors hover:text-slate-300"
								title="Refresh status"
							>
								<RefreshCw className="h-3.5 w-3.5" />
								<span>Refresh</span>
							</button>
						</div>

						<div className="mt-4 grid w-full gap-6 md:grid-cols-2">
							<div className="rounded-xl border border-white/10 bg-white/5 p-6">
								<h3 className="text-lg font-medium text-white">About this data</h3>
								<p className="mt-2 text-sm text-slate-400">
									This status page is powered by{' '}
									<a
										className="font-semibold text-sky-300 hover:text-white"
										href="https://debridmediamanager.com/"
										rel="noreferrer noopener"
										target="_blank"
									>
										Debrid Media Manager
									</a>
									, a free, open source dashboard for Real-Debrid, AllDebrid, and
									TorBox. We run automated health checks every 5 minutes to
									monitor stream server and{' '}
									<a
										className="font-semibold text-sky-300 hover:text-white"
										href="https://torrentio.strem.fun/configure"
										rel="noreferrer noopener"
										target="_blank"
									>
										Torrentio
									</a>{' '}
									availability.
								</p>
							</div>

							<div className="rounded-xl border border-white/10 bg-white/5 p-6">
								<h3 className="flex items-center gap-2 text-lg font-medium text-white">
									<span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
									Is it just you?
								</h3>
								<p className="mt-2 text-sm text-slate-400">
									Check your internet connection first. If Real-Debrid is down for
									everyone, you&apos;ll see failure here. If this page says
									&quot;Operational&quot; but you can&apos;t connect, the issue
									might be your ISP or local network.
								</p>
							</div>
						</div>
					</header>

					{/* Stream Health & Info */}
					<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
						<div
							data-testid="working-stream-card"
							className="rounded-xl border border-white/10 bg-white/5 p-6"
						>
							<h3 className="flex items-center gap-2 text-sm font-medium text-slate-300">
								<Wifi className="h-4 w-4" />
								Stream Server Check
							</h3>
							<div className="mt-4">
								<div className="flex items-baseline gap-2">
									<span
										className={`text-3xl font-bold ${
											workingStream.total === 0
												? 'text-slate-400'
												: workingStream.rate >= 0.8
													? 'text-emerald-400'
													: workingStream.rate >= 0.4
														? 'text-amber-400'
														: 'text-rose-500'
										}`}
									>
										{workingStream.total > 0
											? `${Math.round(workingStream.rate * 100)}%`
											: '—'}
									</span>
									<span className="text-sm text-slate-400">
										{workingStream.total > 0
											? `${workingStream.working}/${workingStream.total} servers`
											: 'no data yet'}
									</span>
								</div>
								{workingServers.length > 0 && (
									<div className="mt-3 space-y-1.5">
										<div className="text-xs font-medium text-emerald-400">
											Working servers ({workingServers.length})
										</div>
										<div className="flex flex-wrap gap-1">
											{workingServers.map((s) => (
												<span
													key={s.server}
													className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs text-emerald-400"
													title={
														s.latencyMs
															? `${Math.round(s.latencyMs)}ms`
															: 'OK'
													}
												>
													{s.server
														.replace('.download.real-debrid.com', '')
														.toUpperCase()}
													{s.latencyMs && (
														<span className="ml-1 text-emerald-300">
															{Math.round(s.latencyMs)}ms
														</span>
													)}
												</span>
											))}
										</div>
									</div>
								)}
								{failedServers.length > 0 && (
									<div className="mt-3 space-y-1.5">
										<div className="text-xs font-medium text-rose-400">
											Failed servers ({failedServers.length})
										</div>
										<div className="flex flex-wrap gap-1">
											{failedServers.map((server) => (
												<span
													key={server}
													className="rounded bg-rose-500/20 px-1.5 py-0.5 text-xs text-rose-400"
												>
													{server
														.replace('.download.real-debrid.com', '')
														.toUpperCase()}
												</span>
											))}
										</div>
									</div>
								)}
								{workingStream.total > 0 && (
									<div className="mt-3 text-xs text-slate-400">
										Latencies measured from Germany
									</div>
								)}
							</div>
						</div>

						<div
							data-testid="rd-api-card"
							className="rounded-xl border border-white/10 bg-white/5 p-6"
						>
							<h3 className="flex items-center gap-2 text-sm font-medium text-slate-300">
								<Activity className="h-4 w-4" />
								API Success Rate (1h)
							</h3>
							<div className="mt-4">
								<div className="flex items-baseline gap-2">
									<span
										className={`text-3xl font-bold ${
											rdApiPct === null
												? 'text-slate-400'
												: rdApiPct >= 95
													? 'text-emerald-400'
													: rdApiPct >= 80
														? 'text-amber-400'
														: 'text-rose-500'
										}`}
									>
										{rdApiPct !== null ? `${rdApiPct}%` : '—'}
									</span>
									<span className="text-sm text-slate-400">
										{rdApiConsidered > 0
											? `${rdApi?.successCount ?? 0} of ${rdApiConsidered}`
											: 'no data yet'}
									</span>
								</div>
								{rdApi && rdApi.totalCount > 0 && (
									<div className="mt-3 space-y-2">
										<div className="text-xs font-medium text-slate-400">
											By operation
										</div>
										{Object.values(rdApi.byOperation)
											.filter((op) => op.totalCount > 0)
											.sort((a, b) => b.totalCount - a.totalCount)
											.map((op) => {
												const pct = Math.round(op.successRate * 100);
												const label = op.operation
													.replace('GET ', '')
													.replace('POST ', '')
													.replace('DELETE ', '')
													.replace('/torrents/', '')
													.replace('{id}', '');
												return (
													<div
														key={op.operation}
														className="flex items-center justify-between text-xs"
													>
														<span
															className="truncate text-slate-400"
															title={op.operation}
														>
															{label}
														</span>
														<div className="flex items-center gap-2">
															{op.failureCount > 0 && (
																<span className="text-rose-400">
																	{op.failureCount} err
																</span>
															)}
															<span
																className={
																	pct >= 95
																		? 'text-emerald-400'
																		: pct >= 80
																			? 'text-amber-400'
																			: 'text-rose-400'
																}
															>
																{pct}%
															</span>
														</div>
													</div>
												);
											})}
									</div>
								)}
							</div>
						</div>

						<div
							data-testid="torrentio-card"
							className="rounded-xl border border-white/10 bg-white/5 p-6"
						>
							<h3 className="flex items-center gap-2 text-sm font-medium text-slate-300">
								<Globe className="h-4 w-4" />
								<a
									href="https://torrentio.strem.fun/configure"
									rel="noreferrer noopener"
									target="_blank"
									className="hover:text-white"
								>
									Torrentio Health
								</a>
							</h3>
							<div className="mt-4">
								<div className="flex items-baseline gap-2">
									<span
										className={`text-3xl font-bold ${
											torrentioPct === null
												? 'text-slate-400'
												: torrentioPct >= 80
													? 'text-emerald-400'
													: torrentioPct >= 40
														? 'text-amber-400'
														: 'text-rose-500'
										}`}
									>
										{torrentioPct !== null ? `${torrentioPct}%` : '—'}
									</span>
									<span className="text-sm text-slate-400">
										{torrentioTotalChecks > 0
											? `${torrentioPassedCount}/${torrentioTotalChecks} passed`
											: 'no data yet'}
									</span>
								</div>
								{torrentioTotalChecks > 0 && (
									<div className="mt-3 space-y-1.5">
										<div className="text-xs font-medium text-slate-400">
											Last {torrentioTotalChecks} checks
										</div>
										{torrentioChecks.map((check, i) => (
											<div
												key={i}
												className="flex items-center justify-between text-xs"
											>
												<div className="flex items-center gap-2">
													<span
														className={`h-2 w-2 rounded-full ${check.ok ? 'bg-emerald-500' : 'bg-rose-500'}`}
													/>
													<span className="text-slate-400">
														{new Date(
															check.checkedAt
														).toLocaleTimeString(FIXED_LOCALE, {
															hour: '2-digit',
															minute: '2-digit',
														})}
													</span>
												</div>
												<span
													className={
														check.ok
															? 'text-emerald-400'
															: 'text-rose-400'
													}
												>
													{check.ok
														? check.latencyMs
															? `${Math.round(check.latencyMs)}ms`
															: 'OK'
														: check.latencyMs
															? `Failed (${Math.round(check.latencyMs)}ms)`
															: 'Failed'}
												</span>
											</div>
										))}
									</div>
								)}
								<div className="mt-3 rounded-lg bg-sky-500/10 p-2.5">
									<p className="text-xs text-slate-300">
										Try{' '}
										<Link
											href="/stremio"
											className="font-semibold text-sky-400 hover:text-sky-300"
										>
											DMM Cast
										</Link>{' '}
										- our Stremio addon for Real-Debrid
									</p>
								</div>
							</div>
						</div>
					</div>

					{/* Charts */}
					<HistoryCharts />

					{/* Footer */}
					<footer className="mt-8 border-t border-white/10 pt-8 text-center">
						<p className="text-sm text-slate-400">
							Debrid Media Manager is an open-source project.
							<a
								href="https://debridmediamanager.com"
								className="ml-1 text-emerald-400 hover:underline"
							>
								Visit Homepage
							</a>
						</p>
					</footer>
				</div>
			</main>
		</>
	);
};

RealDebridStatusPage.disableLibraryProvider = true;

export default RealDebridStatusPage;
