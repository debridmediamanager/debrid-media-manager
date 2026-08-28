import { BarChart3, Clock, TrendingUp } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts';

type HistoryRange = '24h' | '7d' | '30d' | '90d';

interface TorBoxApiHourlyData {
	hour: string;
	totalCount: number;
	successCount: number;
	failureCount: number;
	successRate: number;
}

interface TorBoxApiDailyData {
	date: string;
	totalCount: number;
	successCount: number;
	failureCount: number;
	avgSuccessRate: number;
	minSuccessRate: number;
	maxSuccessRate: number;
}

interface HistoryResponse<T> {
	type: string;
	granularity?: string;
	range: string;
	data: T[];
}

// Reader-browser CDN probes. `time` is an hour start or a UTC midnight; the
// server has already folded the per-region rows into one point per bucket.
interface TorBoxCdnBucket {
	time: string;
	okCount: number;
	failCount: number;
	rate: number;
	avgLatencyMs: number | null;
}

interface TorBoxCdnRegionSummary {
	region: string;
	okCount: number;
	failCount: number;
	rate: number;
	avgLatencyMs: number | null;
}

interface TorBoxCdnResponse extends HistoryResponse<TorBoxCdnBucket> {
	regions?: TorBoxCdnRegionSummary[];
	regionWindowHours?: number;
}

// Human names for the region codes TorBox returns from /api/speedtest. Kept in
// step with the same table in lib/observability/torboxCdnProbe.ts.
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

const FIXED_LOCALE = 'en-US';

// TorBox indigo, per the service colour coding in CLAUDE.md.
const TORBOX_INDIGO = '#4f46e5';
const USER_API_SKY = '#0ea5e9';
const CDN_EMERALD = '#10b981';

// Below this many region votes an hour says nothing: one reader behind a DNS
// block would read as a global CDN outage. The panel's own live reading is
// per-reader and needs no floor; this chart aggregates strangers, so it does.
// Every reader contributes one vote per region, so the hourly floor is roughly
// "more than one visitor".
const CDN_MIN_SAMPLE = 20;

// The per-region floor is lower because it is a different denominator: the
// hourly one counts every region together, while a single region collects one
// vote per visitor over a whole day. Holding it to 20 would leave every region
// unreported on a quiet day, which is how this first read back as "3 checks"
// across the board.
const CDN_MIN_REGION_SAMPLE = 10;

// Ensure UTC timestamps are parsed correctly (append Z if missing timezone)
function parseUtcDate(dateStr: string): Date {
	if (/[Z+-]\d{0,4}$/.test(dateStr)) {
		return new Date(dateStr);
	}
	return new Date(dateStr + 'Z');
}

function formatShortDate(dateStr: string): string {
	return parseUtcDate(dateStr).toLocaleDateString(FIXED_LOCALE, {
		month: 'short',
		day: 'numeric',
	});
}

function formatShortTime(dateStr: string): string {
	return parseUtcDate(dateStr).toLocaleTimeString(FIXED_LOCALE, {
		hour: '2-digit',
		minute: '2-digit',
	});
}

function formatDateAndTime(dateStr: string): string {
	return parseUtcDate(dateStr).toLocaleDateString(FIXED_LOCALE, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

function formatPercent(value: number): string {
	return `${Math.round(value * 100)}%`;
}

function formatCount(value: number): string {
	return value.toLocaleString(FIXED_LOCALE);
}

interface UserApiChartPoint {
	time: string;
	successRate: number;
	totalCount: number;
	failureCount: number;
}

export function TorBoxHistoryCharts() {
	const [range, setRange] = useState<HistoryRange>('24h');
	const [userApiData, setUserApiData] = useState<(TorBoxApiHourlyData | TorBoxApiDailyData)[]>(
		[]
	);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [granularity, setGranularity] = useState<'hourly' | 'daily'>('hourly');
	const [cdnData, setCdnData] = useState<TorBoxCdnBucket[]>([]);
	const [cdnRegions, setCdnRegions] = useState<TorBoxCdnRegionSummary[]>([]);
	const [cdnRegionWindowHours, setCdnRegionWindowHours] = useState(24);

	const fetchHistory = useCallback(
		async (isActive: () => boolean = () => true) => {
			if (!isActive()) return;
			setLoading(true);
			setError(null);

			try {
				const origin =
					typeof window !== 'undefined' && window.location?.origin
						? window.location.origin
						: 'http://localhost:3000';

				// The CDN series is fetched alongside rather than instead of the
				// API one: they answer different questions (does TorBox reply vs
				// does TorBox serve bytes to this reader) and either can be
				// healthy while the other is not.
				const [response, cdnResponse] = await Promise.all([
					fetch(`${origin}/api/observability/history?type=torbox-api&range=${range}`),
					fetch(`${origin}/api/observability/history?type=torbox-cdn&range=${range}`),
				]);

				if (!response.ok) {
					throw new Error('Failed to fetch TorBox history data');
				}

				const json = (await response.json()) as HistoryResponse<
					TorBoxApiHourlyData | TorBoxApiDailyData
				>;

				// A missing CDN series is an empty chart, never a failed page -
				// it is the newer of the two and an older deployment has no
				// route for it at all.
				let cdnJson: TorBoxCdnResponse | null = null;
				if (cdnResponse.ok) {
					cdnJson = (await cdnResponse.json()) as TorBoxCdnResponse;
				}

				if (!isActive()) return;
				setUserApiData(json.data ?? []);
				setGranularity((json.granularity as 'hourly' | 'daily') ?? 'hourly');
				setCdnData(cdnJson?.data ?? []);
				setCdnRegions(cdnJson?.regions ?? []);
				setCdnRegionWindowHours(cdnJson?.regionWindowHours ?? 24);
			} catch (err) {
				if (!isActive()) return;
				console.error('Failed to fetch TorBox history:', err);
				setError(err instanceof Error ? err.message : 'Failed to load history');
			} finally {
				if (isActive()) {
					setLoading(false);
				}
			}
		},
		[range]
	);

	useEffect(() => {
		let isActive = true;
		fetchHistory(() => isActive);
		return () => {
			isActive = false;
		};
	}, [fetchHistory]);

	const isMultiDay = granularity === 'hourly' && range !== '24h';

	function formatTickLabel(time: string): string {
		if (granularity === 'daily') return formatShortDate(time);
		return isMultiDay ? formatShortDate(time) : formatShortTime(time);
	}

	function formatTooltipLabel(time: string): string {
		if (granularity === 'daily') return formatShortDate(time);
		return isMultiDay ? formatDateAndTime(time) : formatShortTime(time);
	}

	const userApiChartData: UserApiChartPoint[] = (userApiData ?? [])
		.map((item) => ({
			time: 'hour' in item ? item.hour : item.date,
			successRate: 'avgSuccessRate' in item ? item.avgSuccessRate : item.successRate,
			totalCount: item.totalCount,
			failureCount: item.failureCount,
		}))
		.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

	// Buckets under the sample floor are plotted as gaps rather than as zeroes:
	// recharts skips a null, so a quiet 4am leaves a break in the line instead of
	// a cliff that reads as an outage.
	const cdnChartData = (cdnData ?? [])
		.map((item) => {
			const sampleCount = item.okCount + item.failCount;
			return {
				time: item.time,
				rate: sampleCount >= CDN_MIN_SAMPLE ? item.rate : null,
				sampleCount,
				failCount: item.failCount,
				avgLatencyMs: item.avgLatencyMs,
			};
		})
		.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

	const hasCdnSamples = cdnChartData.some((point) => point.rate !== null);

	const rangeOptions: { value: HistoryRange; label: string }[] = [
		{ value: '24h', label: '24 Hours' },
		{ value: '7d', label: '7 Days' },
		{ value: '30d', label: '30 Days' },
		{ value: '90d', label: '90 Days' },
	];

	const granularityLabel = granularity === 'hourly' ? 'Hourly' : 'Daily';

	if (loading) {
		return (
			<section className="space-y-6 rounded-xl border border-white/10 bg-black/25 p-5">
				<div className="flex items-center gap-3">
					<TrendingUp className="h-5 w-5 text-slate-400" />
					<h2 className="text-lg font-semibold text-white">Historical Data</h2>
				</div>
				<div className="flex h-64 items-center justify-center">
					<div className="flex items-center gap-2 text-slate-400">
						<Clock className="h-5 w-5 animate-pulse" />
						<span>Loading history...</span>
					</div>
				</div>
			</section>
		);
	}

	if (error) {
		return (
			<section className="space-y-6 rounded-xl border border-white/10 bg-black/25 p-5">
				<div className="flex items-center gap-3">
					<TrendingUp className="h-5 w-5 text-slate-400" />
					<h2 className="text-lg font-semibold text-white">Historical Data</h2>
				</div>
				<div className="flex h-64 items-center justify-center">
					<div className="text-center text-slate-400">
						<p>Unable to load historical data</p>
						<p className="mt-1 text-xs text-slate-500">{error}</p>
						<button
							onClick={() => fetchHistory()}
							className="mt-3 rounded-lg bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600"
						>
							Retry
						</button>
					</div>
				</div>
			</section>
		);
	}

	const axisProps = {
		tick: { fill: '#94a3b8', fontSize: 10 },
		tickLine: false,
		axisLine: { stroke: '#475569' },
	};

	const tooltipProps = {
		contentStyle: {
			backgroundColor: '#1e293b',
			border: '1px solid #334155',
			borderRadius: '8px',
		},
		labelStyle: { color: '#f1f5f9' },
	};

	return (
		<section className="space-y-6 rounded-xl border border-white/10 bg-black/25 p-5">
			<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
				<div className="flex items-center gap-3">
					<TrendingUp className="h-5 w-5 text-slate-400" />
					<div>
						<h2 className="text-lg font-semibold text-white">Historical Data</h2>
						<p className="text-xs text-slate-400">
							{granularityLabel} aggregates for the past {range}
						</p>
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					{rangeOptions.map((option) => (
						<button
							key={option.value}
							onClick={() => setRange(option.value)}
							className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
								range === option.value
									? 'bg-[#4f46e5] text-white'
									: 'bg-slate-800 text-slate-300 hover:bg-slate-700'
							}`}
						>
							{option.label}
						</button>
					))}
				</div>
			</div>

			{userApiChartData.length === 0 && cdnChartData.length === 0 ? (
				<div className="flex h-64 items-center justify-center">
					<div className="text-center text-slate-400">
						<BarChart3 className="mx-auto h-12 w-12 text-slate-600" />
						<p className="mt-3">No historical data available yet</p>
						<p className="mt-1 text-xs text-slate-500">
							Data appears once DMM users start calling TorBox, or once visitors start
							checking the CDN above
						</p>
					</div>
				</div>
			) : (
				<div className="space-y-6">
					{userApiChartData.length > 0 && (
						<>
							<div
								data-testid="torbox-user-api-chart"
								className="rounded-xl border border-white/10 bg-black/20 p-4"
							>
								<h3 className="mb-4 text-sm font-medium text-slate-200">
									User API Success Rate
								</h3>
								<ResponsiveContainer width="100%" height={200}>
									<AreaChart data={userApiChartData}>
										<defs>
											<linearGradient
												id="torboxUserApiGradient"
												x1="0"
												y1="0"
												x2="0"
												y2="1"
											>
												<stop
													offset="5%"
													stopColor={USER_API_SKY}
													stopOpacity={0.3}
												/>
												<stop
													offset="95%"
													stopColor={USER_API_SKY}
													stopOpacity={0}
												/>
											</linearGradient>
										</defs>
										<CartesianGrid strokeDasharray="3 3" stroke="#334155" />
										<XAxis
											dataKey="time"
											{...axisProps}
											interval="preserveStartEnd"
											minTickGap={40}
											tickFormatter={formatTickLabel}
										/>
										<YAxis
											{...axisProps}
											tickFormatter={(v) => formatPercent(v)}
											domain={[0, 1]}
										/>
										<Tooltip
											{...tooltipProps}
											labelFormatter={(_, payload) =>
												payload && payload.length > 0
													? formatTooltipLabel(payload[0].payload.time)
													: ''
											}
											formatter={(value, _name, entry) => [
												`${formatPercent(value as number)} of ${formatCount(
													entry?.payload?.totalCount ?? 0
												)} calls`,
												'Success rate',
											]}
										/>
										<Area
											type="monotone"
											dataKey="successRate"
											stroke={USER_API_SKY}
											fill="url(#torboxUserApiGradient)"
											strokeWidth={2}
										/>
									</AreaChart>
								</ResponsiveContainer>
							</div>

							{/*
					  Volume sits next to the rate because the rate alone is
					  unreadable without it: a quiet hour can swing to 0% on a
					  handful of calls, which is a sample-size artefact rather
					  than an outage.
					*/}
							<div
								data-testid="torbox-volume-chart"
								className="rounded-xl border border-white/10 bg-black/20 p-4"
							>
								<h3 className="mb-4 text-sm font-medium text-slate-200">
									TorBox Calls by DMM Users
								</h3>
								<ResponsiveContainer width="100%" height={200}>
									<AreaChart data={userApiChartData}>
										<defs>
											<linearGradient
												id="torboxVolumeGradient"
												x1="0"
												y1="0"
												x2="0"
												y2="1"
											>
												<stop
													offset="5%"
													stopColor={TORBOX_INDIGO}
													stopOpacity={0.3}
												/>
												<stop
													offset="95%"
													stopColor={TORBOX_INDIGO}
													stopOpacity={0}
												/>
											</linearGradient>
										</defs>
										<CartesianGrid strokeDasharray="3 3" stroke="#334155" />
										<XAxis
											dataKey="time"
											{...axisProps}
											interval="preserveStartEnd"
											minTickGap={40}
											tickFormatter={formatTickLabel}
										/>
										<YAxis
											{...axisProps}
											tickFormatter={(v) => formatCount(v)}
										/>
										<Tooltip
											{...tooltipProps}
											labelFormatter={(_, payload) =>
												payload && payload.length > 0
													? formatTooltipLabel(payload[0].payload.time)
													: ''
											}
											formatter={(value, _name, entry) => [
												`${formatCount(value as number)} calls, ${formatCount(
													entry?.payload?.failureCount ?? 0
												)} server errors`,
												'Volume',
											]}
										/>
										<Area
											type="monotone"
											dataKey="totalCount"
											stroke={TORBOX_INDIGO}
											fill="url(#torboxVolumeGradient)"
											strokeWidth={2}
										/>
									</AreaChart>
								</ResponsiveContainer>
							</div>
						</>
					)}

					{/*
					  The CDN series measures something the API series cannot:
					  whether TorBox hands over bytes, and to whom. Every point is
					  a fold of readers' own browser probes from their own
					  networks - so a dip here with a flat API line above it is
					  the data path, not the service.
					*/}
					<div
						data-testid="torbox-cdn-chart"
						className="rounded-xl border border-white/10 bg-black/20 p-4"
					>
						<h3 className="mb-1 text-sm font-medium text-slate-200">
							CDN Regions Serving Bytes
						</h3>
						<p className="mb-4 text-xs text-slate-500">
							Measured in visitors&apos; own browsers, across their own networks -
							never by a probe of ours.
						</p>
						{hasCdnSamples ? (
							<ResponsiveContainer width="100%" height={200}>
								<AreaChart data={cdnChartData}>
									<defs>
										<linearGradient
											id="torboxCdnGradient"
											x1="0"
											y1="0"
											x2="0"
											y2="1"
										>
											<stop
												offset="5%"
												stopColor={CDN_EMERALD}
												stopOpacity={0.3}
											/>
											<stop
												offset="95%"
												stopColor={CDN_EMERALD}
												stopOpacity={0}
											/>
										</linearGradient>
									</defs>
									<CartesianGrid strokeDasharray="3 3" stroke="#334155" />
									<XAxis
										dataKey="time"
										{...axisProps}
										interval="preserveStartEnd"
										minTickGap={40}
										tickFormatter={formatTickLabel}
									/>
									<YAxis
										{...axisProps}
										tickFormatter={(v) => formatPercent(v)}
										domain={[0, 1]}
									/>
									<Tooltip
										{...tooltipProps}
										labelFormatter={(_, payload) =>
											payload && payload.length > 0
												? formatTooltipLabel(payload[0].payload.time)
												: ''
										}
										formatter={(value, _name, entry) => [
											`${formatPercent(value as number)} of ${formatCount(
												entry?.payload?.sampleCount ?? 0
											)} region checks`,
											'Serving bytes',
										]}
									/>
									<Area
										type="monotone"
										dataKey="rate"
										stroke={CDN_EMERALD}
										fill="url(#torboxCdnGradient)"
										strokeWidth={2}
										connectNulls={false}
									/>
								</AreaChart>
							</ResponsiveContainer>
						) : (
							<div
								data-testid="torbox-cdn-empty"
								className="flex h-[200px] items-center justify-center text-center text-sm text-slate-500"
							>
								<div>
									<p>Not enough visitor checks yet</p>
									<p className="mt-1 text-xs">
										An hour needs {CDN_MIN_SAMPLE} region checks before it is
										plotted, so one visitor behind a DNS block cannot read as a
										global outage.
									</p>
								</div>
							</div>
						)}

						{/*
						  The line alone is not actionable - a dip says something
						  is wrong, not what. TorBox spreads its nodes over
						  several domains, so a filtered domain shows up here as
						  its whole group of regions sitting at the bottom.
						*/}
						{cdnRegions.length > 0 && (
							<div className="mt-4 border-t border-white/10 pt-4">
								<div className="mb-2 text-xs font-medium text-slate-400">
									By region, last {cdnRegionWindowHours}h
								</div>
								<div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
									{cdnRegions.map((region) => {
										const considered = region.okCount + region.failCount;
										const enough = considered >= CDN_MIN_REGION_SAMPLE;
										return (
											<div
												key={region.region}
												className="flex items-center justify-between gap-2 text-xs"
											>
												<span className="truncate text-slate-400">
													{regionLabel(region.region)}
												</span>
												<div className="flex flex-shrink-0 items-center gap-2">
													{region.avgLatencyMs !== null && (
														<span className="text-slate-600">
															{Math.round(region.avgLatencyMs)}ms
														</span>
													)}
													<span
														className={
															!enough
																? 'text-slate-500'
																: region.rate >= 0.9
																	? 'text-emerald-400'
																	: region.rate >= 0.5
																		? 'text-amber-400'
																		: 'text-rose-500'
														}
														title={`${formatCount(region.okCount)} of ${formatCount(considered)} checks served bytes`}
													>
														{enough
															? formatPercent(region.rate)
															: `${formatCount(considered)} ${considered === 1 ? 'check' : 'checks'}`}
													</span>
												</div>
											</div>
										);
									})}
								</div>
							</div>
						)}
					</div>
				</div>
			)}
		</section>
	);
}
