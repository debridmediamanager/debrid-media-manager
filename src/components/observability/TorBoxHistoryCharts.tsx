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

interface TorBoxHourlyData {
	hour: string;
	totalNodes: number;
	workingNodes: number;
	workingRate: number;
	apiSuccessRate: number;
	avgLatencyMs: number | null;
}

interface TorBoxDailyData {
	date: string;
	avgWorkingRate: number;
	minWorkingRate: number;
	maxWorkingRate: number;
	avgApiSuccessRate: number;
	avgLatencyMs: number | null;
	checksCount: number;
}

interface HistoryResponse<T> {
	type: string;
	granularity?: string;
	range: string;
	data: T[];
}

const FIXED_LOCALE = 'en-US';

// TorBox indigo, per the service colour coding in CLAUDE.md.
const TORBOX_INDIGO = '#4f46e5';
const LATENCY_SKY = '#38bdf8';

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

interface ChartPoint {
	time: string;
	workingRate: number;
	apiSuccessRate: number;
	avgLatencyMs: number | null;
}

export function TorBoxHistoryCharts() {
	const [range, setRange] = useState<HistoryRange>('24h');
	const [data, setData] = useState<(TorBoxHourlyData | TorBoxDailyData)[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [granularity, setGranularity] = useState<'hourly' | 'daily'>('hourly');

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

				const response = await fetch(
					`${origin}/api/observability/history?type=torbox&range=${range}`
				);

				if (!response.ok) {
					throw new Error('Failed to fetch TorBox history data');
				}

				const json = (await response.json()) as HistoryResponse<
					TorBoxHourlyData | TorBoxDailyData
				>;

				if (!isActive()) return;
				setData(json.data ?? []);
				setGranularity((json.granularity as 'hourly' | 'daily') ?? 'hourly');
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

	const chartData: ChartPoint[] = (data ?? [])
		.map((item) => ({
			time: 'hour' in item ? item.hour : item.date,
			workingRate: 'avgWorkingRate' in item ? item.avgWorkingRate : item.workingRate,
			apiSuccessRate:
				'avgApiSuccessRate' in item ? item.avgApiSuccessRate : item.apiSuccessRate,
			avgLatencyMs: item.avgLatencyMs,
		}))
		.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

	const latencyData = chartData.filter((point) => point.avgLatencyMs !== null);

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

			{chartData.length === 0 ? (
				<div className="flex h-64 items-center justify-center">
					<div className="text-center text-slate-400">
						<BarChart3 className="mx-auto h-12 w-12 text-slate-600" />
						<p className="mt-3">No historical data available yet</p>
						<p className="mt-1 text-xs text-slate-500">
							Data appears after the first health check runs
						</p>
					</div>
				</div>
			) : (
				<div className="space-y-6">
					<div
						data-testid="torbox-cdn-chart"
						className="rounded-xl border border-white/10 bg-black/20 p-4"
					>
						<h3 className="mb-4 text-sm font-medium text-slate-200">
							CDN Nodes Serving Bytes
						</h3>
						<ResponsiveContainer width="100%" height={200}>
							<AreaChart data={chartData}>
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
											stopColor={TORBOX_INDIGO}
											stopOpacity={0.4}
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
									formatter={(value) => [
										formatPercent(value as number),
										'Nodes serving',
									]}
								/>
								<Area
									type="monotone"
									dataKey="workingRate"
									stroke={TORBOX_INDIGO}
									fill="url(#torboxCdnGradient)"
									strokeWidth={2}
								/>
							</AreaChart>
						</ResponsiveContainer>
					</div>

					<div
						data-testid="torbox-api-chart"
						className="rounded-xl border border-white/10 bg-black/20 p-4"
					>
						<h3 className="mb-4 text-sm font-medium text-slate-200">
							API Availability
						</h3>
						<ResponsiveContainer width="100%" height={200}>
							<AreaChart data={chartData}>
								<defs>
									<linearGradient
										id="torboxApiGradient"
										x1="0"
										y1="0"
										x2="0"
										y2="1"
									>
										<stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
										<stop offset="95%" stopColor="#10b981" stopOpacity={0} />
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
									formatter={(value) => [
										formatPercent(value as number),
										'API up',
									]}
								/>
								<Area
									type="monotone"
									dataKey="apiSuccessRate"
									stroke="#10b981"
									fill="url(#torboxApiGradient)"
									strokeWidth={2}
								/>
							</AreaChart>
						</ResponsiveContainer>
					</div>

					{latencyData.length > 0 && (
						<div
							data-testid="torbox-latency-chart"
							className="rounded-xl border border-white/10 bg-black/20 p-4"
						>
							<h3 className="mb-4 text-sm font-medium text-slate-200">
								Average CDN Latency
							</h3>
							<ResponsiveContainer width="100%" height={200}>
								<AreaChart data={latencyData}>
									<defs>
										<linearGradient
											id="torboxLatencyGradient"
											x1="0"
											y1="0"
											x2="0"
											y2="1"
										>
											<stop
												offset="5%"
												stopColor={LATENCY_SKY}
												stopOpacity={0.3}
											/>
											<stop
												offset="95%"
												stopColor={LATENCY_SKY}
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
										tickFormatter={(v) => `${Math.round(v as number)}ms`}
									/>
									<Tooltip
										{...tooltipProps}
										labelFormatter={(_, payload) =>
											payload && payload.length > 0
												? formatTooltipLabel(payload[0].payload.time)
												: ''
										}
										formatter={(value) => [
											`${Math.round(value as number)}ms`,
											'Avg latency',
										]}
									/>
									<Area
										type="monotone"
										dataKey="avgLatencyMs"
										stroke={LATENCY_SKY}
										fill="url(#torboxLatencyGradient)"
										strokeWidth={2}
									/>
								</AreaChart>
							</ResponsiveContainer>
						</div>
					)}
				</div>
			)}
		</section>
	);
}
