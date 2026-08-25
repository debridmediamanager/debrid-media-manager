import { useConnectivity } from '@/hooks/useConnectivity';
import type { TorBoxObservabilityStats } from '@/lib/observability/getTorBoxObservabilityStats';
import { TORBOX_REFERRAL_URL } from '@/utils/referrals';
import type { LucideIcon } from 'lucide-react';
import {
	Activity,
	AlertTriangle,
	CheckCircle2,
	Clock,
	Globe,
	Loader2,
	RefreshCw,
	Server,
	Users,
	WifiOff,
} from 'lucide-react';
import type { NextPage } from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';

// Dynamic import with ssr: false to avoid Recharts SSR compatibility issues
const TorBoxHistoryCharts = dynamic(
	() =>
		import('@/components/observability/TorBoxHistoryCharts').then(
			(mod) => mod.TorBoxHistoryCharts
		),
	{ ssr: false }
);

const FIXED_LOCALE = 'en-US';
const REFRESH_INTERVAL_MS = 60_000;
// The cron runs every 5 minutes. Three missed runs is a stalled collector, not
// jitter, and the page says so rather than presenting old numbers as current.
const STALE_AFTER_MS = 15 * 60 * 1000;

// Human names for the region codes TorBox returns from /api/speedtest.
const REGION_NAMES: Record<string, string> = {
	ceur: 'Central Europe',
	weur: 'Western Europe',
	neur: 'Northern Europe',
	seur: 'Southern Europe',
	nord: 'Nordics',
	slav: 'Eastern Europe',
	enam: 'Eastern North America',
	cnam: 'Central North America',
	wnam: 'Western North America',
	snam: 'Southern North America',
	latm: 'Latin America',
	apac: 'Asia-Pacific',
	japn: 'Japan',
	indi: 'India',
	zafr: 'Southern Africa',
	hare: 'Anycast (Bunny)',
	erth: 'Anycast (Cloudflare)',
};

function regionLabel(region: string): string {
	return REGION_NAMES[region] ?? region.toUpperCase();
}

function formatDateTime(timestamp: number): string {
	return new Date(timestamp).toLocaleString(FIXED_LOCALE, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
}

function formatRelative(timestamp: number, now: number): string {
	const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
}

function formatCount(value: number): string {
	return value.toLocaleString(FIXED_LOCALE);
}

type StatusState = 'idle' | 'up' | 'degraded' | 'down';

function isTorBoxObservabilityPayload(value: unknown): value is TorBoxObservabilityStats {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Record<string, unknown>;
	if (!candidate.cdn || typeof candidate.cdn !== 'object') return false;
	if (!candidate.api || typeof candidate.api !== 'object') return false;
	return true;
}

const TorBoxStatusPage: NextPage & { disableLibraryProvider?: boolean } = () => {
	const [stats, setStats] = useState<TorBoxObservabilityStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [fetchFailed, setFetchFailed] = useState(false);
	const [now, setNow] = useState<number>(() => Date.now());
	const isOnline = useConnectivity();

	const loadStats = async () => {
		try {
			const cacheBuster = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
			const requestUrl = new URL('/api/observability/torbox', window.location.origin);
			requestUrl.search = new URLSearchParams({ _t: cacheBuster }).toString();

			const response = await fetch(requestUrl.toString(), { cache: 'no-store' });
			if (!response.ok) {
				console.error('TorBox stats fetch failed with status', response.status);
				setFetchFailed(true);
				return;
			}

			const payload: unknown = await response.json();
			if (!isTorBoxObservabilityPayload(payload)) {
				console.error('Received invalid TorBox stats payload', payload);
				setFetchFailed(true);
				return;
			}

			setStats(payload);
			setFetchFailed(false);
		} catch (error) {
			console.error('Failed to fetch TorBox stats', error);
			setFetchFailed(true);
		} finally {
			setLoading(false);
			setNow(Date.now());
		}
	};

	useEffect(() => {
		loadStats();
		const interval = setInterval(loadStats, REFRESH_INTERVAL_MS);
		return () => clearInterval(interval);
	}, []);

	// Keeps the "x minutes ago" label honest between fetches, so a stalled
	// collector visibly ages instead of freezing at its last value.
	useEffect(() => {
		const tick = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(tick);
	}, []);

	const pageTitle = 'Is TorBox Down Or Just Me?';
	const canonicalUrl = 'https://debridmediamanager.com/is-torbox-down-or-just-me';
	const defaultDescription =
		'Live TorBox availability dashboard: real DMM-user API success rates, plus a per-region check that every TorBox CDN node is actually serving bytes.';

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
						<p className="text-slate-400">Checking TorBox status...</p>
					</div>
				</main>
			</>
		);
	}

	const { cdn, api, service, tbApi } = stats;
	const cdnPct = cdn.total > 0 ? Math.round(cdn.rate * 100) : null;

	// What TorBox returned to real DMM users in the last hour. Only 5xx counts
	// as a failure, so a user's own bad key never drags this down.
	const tbApiPct = tbApi && tbApi.totalCount > 0 ? Math.round(tbApi.successRate * 100) : null;
	const tbApiConsidered = tbApi ? tbApi.successCount + tbApi.failureCount : 0;
	const workingNodes = cdn.nodes.filter((node) => node.ok);
	const failedNodes = cdn.nodes.filter((node) => !node.ok);

	const lastChecked = stats.lastChecked;
	const isStale = lastChecked !== null && now - lastChecked > STALE_AFTER_MS;
	const hasData = cdn.total > 0 || api.totalCount > 0;

	// The verdict is derived only from unauthenticated signals - the API root
	// and the CDN nodes. A rejected API key says something about our key, not
	// about TorBox, so it is reported separately and never counted here.
	const state: StatusState = !hasData
		? 'idle'
		: api.ok === false || (cdnPct !== null && cdnPct < 50)
			? 'down'
			: cdnPct !== null && cdnPct < 90
				? 'degraded'
				: 'up';

	const statusMeta: Record<
		StatusState,
		{
			label: string;
			badge: string;
			description: string;
			colorClass: string;
			bgColorClass: string;
			borderColorClass: string;
			pingClass: string;
			dotClass: string;
			icon: LucideIcon;
		}
	> = {
		idle: {
			label: 'Waiting for data',
			badge: 'Collecting data',
			description: 'Collecting initial samples...',
			colorClass: 'text-slate-400',
			bgColorClass: 'bg-slate-500/10',
			borderColorClass: 'border-slate-500/20',
			pingClass: 'bg-slate-400',
			dotClass: 'bg-slate-500',
			icon: Clock,
		},
		up: {
			label: 'TorBox is Operational',
			badge: 'Operational',
			description: 'API responding and CDN nodes serving bytes',
			colorClass: 'text-emerald-400',
			bgColorClass: 'bg-emerald-500/10',
			borderColorClass: 'border-emerald-500/20',
			pingClass: 'bg-emerald-400',
			dotClass: 'bg-emerald-500',
			icon: CheckCircle2,
		},
		degraded: {
			label: 'TorBox is Partially Degraded',
			badge: 'Partial Outage',
			description: 'Some regions are not serving bytes',
			colorClass: 'text-amber-400',
			bgColorClass: 'bg-amber-500/10',
			borderColorClass: 'border-amber-500/20',
			pingClass: 'bg-amber-400',
			dotClass: 'bg-amber-500',
			icon: AlertTriangle,
		},
		down: {
			label: 'TorBox is Down',
			badge: 'Major Outage',
			description: 'API or CDN nodes not responding',
			colorClass: 'text-rose-500',
			bgColorClass: 'bg-rose-500/10',
			borderColorClass: 'border-rose-500/20',
			pingClass: 'bg-rose-500',
			dotClass: 'bg-rose-600',
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
				{!isOnline && (
					<div className="bg-amber-500/10 px-4 py-2 text-center text-sm font-medium text-amber-500">
						<div className="mx-auto flex max-w-5xl items-center justify-center gap-2">
							<WifiOff className="h-4 w-4" />
							<span>You are offline. This status might not be up to date.</span>
						</div>
					</div>
				)}

				{(isStale || fetchFailed) && (
					<div
						data-testid="stale-banner"
						className="bg-amber-500/10 px-4 py-2 text-center text-sm font-medium text-amber-500"
					>
						<div className="mx-auto flex max-w-5xl items-center justify-center gap-2">
							<AlertTriangle className="h-4 w-4" />
							<span>
								{fetchFailed
									? 'Could not reach the status API just now - showing the last result we have.'
									: `These checks stopped updating ${lastChecked !== null ? formatRelative(lastChecked, now) : ''}. Treat the readings below as stale.`}
							</span>
						</div>
					</div>
				)}

				<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
					<header className="flex flex-col items-center gap-6 pt-8 text-center">
						<div
							className={`flex items-center gap-3 rounded-full border px-6 py-2 ${currentStatus.bgColorClass} ${currentStatus.borderColorClass}`}
						>
							<div className="relative flex h-3 w-3">
								<span
									className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${currentStatus.pingClass}`}
								></span>
								<span
									className={`relative inline-flex h-3 w-3 rounded-full ${currentStatus.dotClass}`}
								></span>
							</div>
							<span className={`font-semibold ${currentStatus.colorClass}`}>
								<span data-testid="status-answer">{currentStatus.badge}</span>
							</span>
						</div>

						<h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
							{currentStatus.label}
						</h1>

						<p className="max-w-2xl text-lg text-slate-400">
							{currentStatus.description}. The verdict above is drawn only from
							TorBox&apos;s public endpoints, so it reflects the service rather than
							any one account.
						</p>

						<div className="flex flex-wrap items-center justify-center gap-4 text-xs font-medium text-slate-500">
							<div className="flex items-center gap-1.5">
								<Clock className="h-3.5 w-3.5" />
								<span data-testid="status-freshness">
									{lastChecked !== null
										? `Checked ${formatRelative(lastChecked, now)} (${formatDateTime(lastChecked)})`
										: 'No check recorded yet'}
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
							<div className="rounded-xl border border-white/10 bg-white/5 p-6 text-left">
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
									, a free, open source dashboard for Real-Debrid, AllDebrid and
									TorBox. Every 5 minutes we ping the{' '}
									<a
										className="font-semibold text-sky-300 hover:text-white"
										href="https://api-docs.torbox.app/"
										rel="noreferrer noopener"
										target="_blank"
									>
										TorBox API
									</a>{' '}
									and ask each advertised CDN node for the first byte of its test
									file. A node only passes on an HTTP 206 - reaching the API
									proves nothing about whether TorBox will serve data. Alongside
									those probes we count what TorBox actually returned to real DMM
									users&apos; own API calls, so an outage shows up in traffic
									nobody had to synthesise.
								</p>
							</div>

							<div className="rounded-xl border border-white/10 bg-white/5 p-6 text-left">
								<h3 className="flex items-center gap-2 text-lg font-medium text-white">
									<span className="flex h-2.5 w-2.5 rounded-full bg-[#4f46e5]"></span>
									Is it just you?
								</h3>
								<p className="mt-2 text-sm text-slate-400">
									If this page says &quot;Operational&quot; but TorBox is failing
									for you, the problem is on your side: check your internet
									connection, then your API key. TorBox rotates the key of an
									account it flags, and a rotated key answers{' '}
									<code className="rounded bg-black/40 px-1 text-xs">
										AUTH_ERROR
									</code>{' '}
									everywhere. A{' '}
									<code className="rounded bg-black/40 px-1 text-xs">
										cooldown_until
									</code>{' '}
									date on your account is not an outage - endpoints keep working
									through it.
								</p>
							</div>
						</div>
					</header>

					<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
						<div
							data-testid="cdn-card"
							className="rounded-xl border border-white/10 bg-white/5 p-6 lg:col-span-2"
						>
							<h3 className="flex items-center gap-2 text-sm font-medium text-slate-300">
								<Server className="h-4 w-4" />
								CDN Nodes Serving Bytes
							</h3>
							<div className="mt-4">
								<div className="flex items-baseline gap-2">
									<span
										className={`text-3xl font-bold ${
											cdnPct === null
												? 'text-slate-400'
												: cdn.rate >= 0.9
													? 'text-emerald-400'
													: cdn.rate >= 0.5
														? 'text-amber-400'
														: 'text-rose-500'
										}`}
									>
										{cdnPct !== null ? `${cdnPct}%` : '—'}
									</span>
									<span className="text-sm text-slate-500">
										{cdn.total > 0
											? `${cdn.working}/${cdn.total} regions`
											: 'no data yet'}
									</span>
								</div>

								{workingNodes.length > 0 && (
									<div className="mt-3 space-y-1.5">
										<div className="text-xs font-medium text-emerald-400">
											Serving ({workingNodes.length})
										</div>
										<div className="flex flex-wrap gap-1">
											{workingNodes.map((node) => (
												<span
													key={node.host}
													className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs text-emerald-400"
													title={`${node.name} · ${node.host}`}
												>
													{regionLabel(node.region)}
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

								{failedNodes.length > 0 && (
									<div className="mt-3 space-y-1.5">
										<div className="text-xs font-medium text-rose-400">
											Not serving ({failedNodes.length})
										</div>
										<div className="flex flex-wrap gap-1">
											{failedNodes.map((node) => (
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

								{cdn.total > 0 && (
									<div className="mt-3 text-xs text-slate-500">
										Range request for the first byte of each region&apos;s test
										file. Latencies measured from Germany
										{cdn.avgLatencyMs !== null &&
											`, ${Math.round(cdn.avgLatencyMs)}ms average`}
										.
									</div>
								)}
							</div>
						</div>

						<div
							data-testid="api-card"
							className="rounded-xl border border-white/10 bg-white/5 p-6"
						>
							<h3 className="flex items-center gap-2 text-sm font-medium text-slate-300">
								<Activity className="h-4 w-4" />
								TorBox API
							</h3>
							<div className="mt-4">
								<div className="flex items-baseline gap-2">
									<span
										className={`text-3xl font-bold ${
											api.ok === null
												? 'text-slate-400'
												: api.ok
													? 'text-emerald-400'
													: 'text-rose-500'
										}`}
									>
										{api.ok === null ? '—' : api.ok ? 'Up' : 'Down'}
									</span>
									<span className="text-sm text-slate-500">
										{api.latencyMs !== null
											? `${Math.round(api.latencyMs)}ms`
											: 'no data yet'}
									</span>
								</div>

								{api.detail && (
									<p className="mt-2 text-xs text-slate-400">{api.detail}</p>
								)}

								{api.totalCount > 0 && (
									<div className="mt-3 space-y-1.5">
										<div className="text-xs font-medium text-slate-500">
											Last {api.totalCount} checks
											{api.successRate !== null &&
												` · ${Math.round(api.successRate * 100)}% up`}
										</div>
										<div className="flex flex-wrap gap-1">
											{[...api.recentChecks].reverse().map((check) => (
												<span
													key={check.checkedAt}
													className={`h-2.5 w-2.5 rounded-sm ${check.apiOk ? 'bg-emerald-500' : 'bg-rose-500'}`}
													title={`${formatDateTime(check.checkedAt)} · ${
														check.apiOk ? 'up' : 'down'
													}${check.apiLatencyMs !== null ? ` · ${Math.round(check.apiLatencyMs)}ms` : ''}`}
												/>
											))}
										</div>
									</div>
								)}
							</div>
						</div>

						<div
							data-testid="tb-api-card"
							className="rounded-xl border border-white/10 bg-white/5 p-6"
						>
							<h3 className="flex items-center gap-2 text-sm font-medium text-slate-300">
								<Users className="h-4 w-4" />
								User API Success Rate (1h)
							</h3>
							<div className="mt-4">
								<div className="flex items-baseline gap-2">
									<span
										data-testid="tb-api-rate"
										className={`text-3xl font-bold ${
											tbApiPct === null
												? 'text-slate-400'
												: tbApiPct >= 95
													? 'text-emerald-400'
													: tbApiPct >= 80
														? 'text-amber-400'
														: 'text-rose-500'
										}`}
									>
										{tbApiPct !== null ? `${tbApiPct}%` : '—'}
									</span>
									<span className="text-sm text-slate-500">
										{tbApiConsidered > 0
											? `${tbApi?.successCount ?? 0} of ${tbApiConsidered}`
											: 'no data yet'}
									</span>
								</div>
								{tbApi && tbApi.totalCount > 0 && (
									<div className="mt-3 space-y-2">
										<div className="text-xs font-medium text-slate-500">
											By operation
										</div>
										{Object.values(tbApi.byOperation)
											.filter((op) => op.totalCount > 0)
											.sort((a, b) => b.totalCount - a.totalCount)
											.map((op) => {
												const pct = Math.round(op.successRate * 100);
												const [method, path] = op.operation.split(' ');
												return (
													<div
														key={op.operation}
														className="flex items-center justify-between gap-2 text-xs"
													>
														<span
															className="truncate text-slate-400"
															title={op.operation}
														>
															<span className="text-slate-600">
																{method}
															</span>{' '}
															{path}
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
								<p className="mt-3 text-xs text-slate-500">
									Counted from real DMM users&apos; own TorBox calls. Only server
									errors count against TorBox.
								</p>
							</div>
						</div>

						<div
							data-testid="service-card"
							className="rounded-xl border border-white/10 bg-white/5 p-6"
						>
							<h3 className="flex items-center gap-2 text-sm font-medium text-slate-300">
								<Globe className="h-4 w-4" />
								Service Scale
							</h3>
							<div className="mt-4 space-y-3">
								<div>
									<div className="text-3xl font-bold text-white">
										{service?.totalServers != null
											? formatCount(service.totalServers)
											: '—'}
									</div>
									<div className="text-xs text-slate-500">servers online</div>
								</div>
								<div>
									<div className="text-xl font-semibold text-slate-200">
										{service?.totalUsers != null
											? formatCount(service.totalUsers)
											: '—'}
									</div>
									<div className="text-xs text-slate-500">registered users</div>
								</div>
								<p className="text-xs text-slate-500">
									Reported live by TorBox&apos;s public stats endpoint.
								</p>
							</div>
						</div>

						<div className="rounded-xl border border-white/10 bg-white/5 p-6">
							<h3 className="text-sm font-medium text-slate-300">Using TorBox?</h3>
							<div className="mt-3 space-y-2 text-xs text-slate-400">
								<p>
									DMM manages your TorBox library, searches for content and casts
									it to Stremio.
								</p>
								<div className="flex flex-wrap gap-2 pt-1">
									<Link
										href="/torbox/login"
										className="rounded bg-[#4f46e5] px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-500"
									>
										Connect TorBox
									</Link>
									<Link
										href="/stremio-torbox"
										className="rounded bg-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-100 hover:bg-slate-600"
									>
										Stremio addon
									</Link>
								</div>
								<p className="pt-2">
									No TorBox account yet?{' '}
									<a
										href={TORBOX_REFERRAL_URL}
										target="_blank"
										rel="noopener noreferrer"
										className="font-semibold text-[#818cf8] hover:text-indigo-300"
									>
										Sign up for TorBox
									</a>
								</p>
								<p>
									Real-Debrid user?{' '}
									<Link
										href="/is-real-debrid-down-or-just-me"
										className="font-semibold text-sky-400 hover:text-sky-300"
									>
										Check Real-Debrid status
									</Link>
								</p>
							</div>
						</div>
					</div>

					<TorBoxHistoryCharts />

					<footer className="mt-8 border-t border-white/10 pt-8 text-center">
						<p className="text-sm text-slate-500">
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

TorBoxStatusPage.disableLibraryProvider = true;

export default TorBoxStatusPage;
