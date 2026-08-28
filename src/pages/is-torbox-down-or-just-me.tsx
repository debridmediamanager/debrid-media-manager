import { useConnectivity } from '@/hooks/useConnectivity';
import type { TorBoxObservabilityStats } from '@/lib/observability/getTorBoxObservabilityStats';
import { TORBOX_REFERRAL_URL } from '@/utils/referrals';
import type { LucideIcon } from 'lucide-react';
import {
	Activity,
	AlertTriangle,
	CheckCircle2,
	Clock,
	Loader2,
	RefreshCw,
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

// Client-only: the panel probes TorBox's CDN from the reader's own browser, so
// there is nothing for the server to render and nothing it could measure.
const TorBoxCdnPanel = dynamic(
	() => import('@/components/observability/TorBoxCdnPanel').then((mod) => mod.TorBoxCdnPanel),
	{ ssr: false }
);

const FIXED_LOCALE = 'en-US';
const REFRESH_INTERVAL_MS = 60_000;

// Verdict bands, shared by the headline and the success-rate card so the two can
// never contradict each other. `down` matches TorBoxOverallStats.isDown.
const UP_THRESHOLD = 0.95;
const DOWN_THRESHOLD = 0.5;

// Below this many counted calls the window says nothing: a handful of requests
// at 4am can read 0% off two unlucky failures. The synthetic probe this page
// used to run had a fixed 12-samples-an-hour floor; real traffic does not, so
// the floor has to be explicit.
const MIN_SAMPLE = 20;

// Counters are bucketed by hour, so a bucket start can legitimately be nearly an
// hour old while traffic is flowing. Two hours means a whole bucket went by with
// no TorBox call recorded at all - that is a stalled pipeline, not a quiet spell.
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

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

function rateColorClass(rate: number | null): string {
	if (rate === null) return 'text-slate-400';
	if (rate >= UP_THRESHOLD) return 'text-emerald-400';
	if (rate >= DOWN_THRESHOLD) return 'text-amber-400';
	return 'text-rose-500';
}

type StatusState = 'idle' | 'up' | 'degraded' | 'down';

function isTorBoxObservabilityPayload(value: unknown): value is TorBoxObservabilityStats {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.windowHours !== 'number') return false;
	if (candidate.tbApi !== null && typeof candidate.tbApi !== 'object') return false;
	return true;
}

const TorBoxStatusPage: NextPage & { disableLibraryProvider?: boolean } = () => {
	const [stats, setStats] = useState<TorBoxObservabilityStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [fetchFailed, setFetchFailed] = useState(false);
	const [loadedAt, setLoadedAt] = useState<number | null>(null);
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
			setLoadedAt(Date.now());
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

	// Keeps the "x minutes ago" label honest between fetches, so a stalled feed
	// visibly ages instead of freezing at its last value.
	useEffect(() => {
		const tick = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(tick);
	}, []);

	const pageTitle = 'Is TorBox Down Or Just Me?';
	const canonicalUrl = 'https://debridmediamanager.com/is-torbox-down-or-just-me';
	const defaultDescription =
		'Live TorBox availability, measured from what TorBox actually returns to real Debrid Media Manager users, plus a per-region CDN check your own browser runs against every TorBox node.';

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

	const { tbApi, windowHours } = stats;
	const windowLabel = `${windowHours}h`;

	// Only 2xx and 5xx are counted. A 4xx is the caller's key or request, and
	// TorBox answers a rejected key with HTTP 200 success:false anyway, so
	// neither says anything about whether TorBox is up.
	const considered = tbApi ? tbApi.successCount + tbApi.failureCount : 0;
	const rate = tbApi && considered > 0 ? tbApi.successRate : null;
	const ratePct = rate !== null ? Math.round(rate * 100) : null;
	const hasEnough = considered >= MIN_SAMPLE;
	const uncounted = tbApi ? Math.max(0, tbApi.totalCount - considered) : 0;

	const lastChecked = stats.lastChecked;
	const isStale = lastChecked !== null && now - lastChecked > STALE_AFTER_MS;

	// The verdict is real user traffic and nothing else. DMM issues no requests
	// of its own to TorBox: a probe from one datacentre IP measures that IP's
	// rate-limit standing, and TorBox 429s it often enough to read as an outage
	// while thousands of user calls are succeeding.
	const state: StatusState =
		!hasEnough || rate === null
			? 'idle'
			: rate >= UP_THRESHOLD
				? 'up'
				: rate >= DOWN_THRESHOLD
					? 'degraded'
					: 'down';

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
			label: 'Not Enough Traffic To Say',
			badge: 'Collecting data',
			description: `Fewer than ${MIN_SAMPLE} DMM user calls to TorBox in the last ${windowLabel}`,
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
			description: 'TorBox is answering DMM users normally',
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
			description: 'Some DMM user calls are coming back as server errors',
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
			description: 'Most DMM user calls are failing with server errors',
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
									: `No TorBox call has been recorded since ${lastChecked !== null ? formatRelative(lastChecked, now) : ''}. Treat the readings below as stale.`}
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
							{currentStatus.description}. The verdict is counted from real DMM
							users&apos; own TorBox calls across many accounts, so it reflects the
							service rather than any one key.
						</p>

						<div className="flex flex-wrap items-center justify-center gap-4 text-xs font-medium text-slate-500">
							<div className="flex items-center gap-1.5">
								<Clock className="h-3.5 w-3.5" />
								<span data-testid="status-freshness">
									{loadedAt !== null
										? `Updated ${formatRelative(loadedAt, now)} (${formatDateTime(loadedAt)})`
										: 'Not loaded yet'}
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
									TorBox. Our servers send TorBox no traffic of their own. The
									verdict above is counted from what the{' '}
									<a
										className="font-semibold text-sky-300 hover:text-white"
										href="https://api-docs.torbox.app/"
										rel="noreferrer noopener"
										target="_blank"
									>
										TorBox API
									</a>{' '}
									returned to real DMM users, across many accounts and many
									networks, as they browsed their libraries. Only a 5xx counts
									against TorBox - a rejected key is the caller&apos;s problem,
									not an outage. The CDN panel below is the one exception, and it
									runs in your browser rather than ours: a probe from a single
									datacentre IP measures that IP&apos;s standing with TorBox, not
									TorBox.
								</p>
							</div>

							<div className="rounded-xl border border-white/10 bg-white/5 p-6 text-left">
								<h3 className="flex items-center gap-2 text-lg font-medium text-white">
									<span className="flex h-2.5 w-2.5 rounded-full bg-[#4f46e5]"></span>
									Is it just you?
								</h3>
								<p className="mt-2 text-sm text-slate-400">
									If this page says &quot;Operational&quot; but TorBox is failing
									for you, the CDN panel below settles where the problem is - it
									tests every TorBox region from your own network. Regions failing
									there and nowhere else means your route, not TorBox. If they all
									pass, check your API key: TorBox rotates the key of an account
									it flags, and a rotated key answers{' '}
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
							data-testid="tb-api-card"
							className="rounded-xl border border-white/10 bg-white/5 p-6 lg:col-span-2"
						>
							<h3 className="flex items-center gap-2 text-sm font-medium text-slate-300">
								<Users className="h-4 w-4" />
								User API Success Rate ({windowLabel})
							</h3>
							<div className="mt-4">
								<div className="flex items-baseline gap-2">
									<span
										data-testid="tb-api-rate"
										className={`text-3xl font-bold ${rateColorClass(rate)}`}
									>
										{ratePct !== null ? `${ratePct}%` : '—'}
									</span>
									<span className="text-sm text-slate-500">
										{considered > 0
											? `${formatCount(tbApi?.successCount ?? 0)} of ${formatCount(considered)}`
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
																	{formatCount(op.failureCount)}{' '}
																	err
																</span>
															)}
															<span
																className={rateColorClass(
																	op.successCount +
																		op.failureCount >
																		0
																		? op.successRate
																		: null
																)}
															>
																{op.successCount + op.failureCount >
																0
																	? `${pct}%`
																	: '—'}
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
							data-testid="volume-card"
							className="rounded-xl border border-white/10 bg-white/5 p-6"
						>
							<h3 className="flex items-center gap-2 text-sm font-medium text-slate-300">
								<Activity className="h-4 w-4" />
								Sample Size
							</h3>
							<div className="mt-4 space-y-3">
								<div>
									<div className="text-3xl font-bold text-white">
										{formatCount(considered)}
									</div>
									<div className="text-xs text-slate-500">
										calls counted in the last {windowLabel}
									</div>
								</div>
								{tbApi && tbApi.failureCount > 0 && (
									<div>
										<div className="text-xl font-semibold text-rose-400">
											{formatCount(tbApi.failureCount)}
										</div>
										<div className="text-xs text-slate-500">
											server errors (5xx)
										</div>
									</div>
								)}
								{uncounted > 0 && (
									<div>
										<div className="text-xl font-semibold text-slate-300">
											{formatCount(uncounted)}
										</div>
										<div className="text-xs text-slate-500">
											excluded - 4xx answers about the caller&apos;s own key
											or request, not about TorBox
										</div>
									</div>
								)}
								{!hasEnough && (
									<p className="text-xs text-amber-400">
										Below the {MIN_SAMPLE}-call floor needed to call it either
										way.
									</p>
								)}
							</div>
						</div>

						<TorBoxCdnPanel />

						<div className="rounded-xl border border-white/10 bg-white/5 p-6 md:col-span-2 lg:col-span-3">
							<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
								<div className="text-xs text-slate-400">
									<h3 className="text-sm font-medium text-slate-300">
										Using TorBox?
									</h3>
									<p className="mt-1">
										DMM manages your TorBox library, searches for content and
										casts it to Stremio.
									</p>
									<p className="mt-2">
										No TorBox account yet?{' '}
										<a
											href={TORBOX_REFERRAL_URL}
											target="_blank"
											rel="noopener noreferrer"
											className="font-semibold text-[#818cf8] hover:text-indigo-300"
										>
											Sign up for TorBox
										</a>
										<span className="px-2 text-slate-600">·</span>
										Real-Debrid user?{' '}
										<Link
											href="/is-real-debrid-down-or-just-me"
											className="font-semibold text-sky-400 hover:text-sky-300"
										>
											Check Real-Debrid status
										</Link>
									</p>
								</div>
								<div className="flex flex-shrink-0 flex-wrap gap-2">
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
