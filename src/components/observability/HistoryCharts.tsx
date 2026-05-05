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

interface StreamHourlyData {
	hour: string;
	totalServers: number;
	workingServers: number;
	workingRate: number;
	avgLatencyMs: number | null;
}

interface StreamDailyData {
	date: string;
	avgWorkingRate: number;
	minWorkingRate: number;
	maxWorkingRate: number;
	avgLatencyMs: number | null;
	checksCount: number;
}

interface RdHourlyData {
	hour: string;
	totalCount: number;
	successCount: number;
	failureCount: number;
	successRate: number;
}

interface RdDailyData {
	date: string;
	totalCount: number;
	successCount: number;
	failureCount: number;
	avgSuccessRate: number;
	minSuccessRate: number;
	maxSuccessRate: number;
}

interface TorrentioHourlyData {
	hour: string;
	successCount: number;
	totalCount: number;
	successRate: number;
	avgLatencyMs: number | null;
}

interface TorrentioDailyData {
	date: string;
	avgSuccessRate: number;
	minSuccessRate: number;
	maxSuccessRate: number;
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

// Ensure UTC timestamps are parsed correctly (append Z if missing timezone)
function parseUtcDate(dateStr: string): Date {
	// If already has timezone info (Z or +/-), parse as-is
	if (/[Z+-]\d{0,4}$/.test(dateStr)) {
		return new Date(dateStr);
	}
	// Otherwise treat as UTC by appending Z
	return new Date(dateStr + 'Z');
}

function formatShortDate(dateStr: string): string {
	const date = parseUtcDate(dateStr);
	return date.toLocaleDateString(FIXED_LOCALE, {
		month: 'short',
		day: 'numeric',
	});
}

function formatShortTime(dateStr: string): string {
	const date = parseUtcDate(dateStr);
	return date.toLocaleTimeString(FIXED_LOCALE, {
		hour: '2-digit',
		minute: '2-digit',
	});
}

function formatDateAndTime(dateStr: string): string {
	const date = parseUtcDate(dateStr);
	return date.toLocaleDateString(FIXED_LOCALE, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

function formatPercent(value: number): string {
	return `${Math.round(value * 100)}%`;
}

export function HistoryCharts() {
	const [range, setRange] = useState<HistoryRange>('24h');
	const [streamData, setStreamData] = useState<(StreamHourlyData | StreamDailyData)[]>([]);
	const [rdData, setRdData] = useState<(RdHourlyData | RdDailyData)[]>([]);
	const [torrentioData, setTorrentioData] = useState<
		(TorrentioHourlyData | TorrentioDailyData)[]
	>([]);
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

				const [streamResponse, rdResponse, torrentioResponse] = await Promise.all([
					fetch(`${origin}/api/observability/history?type=stream&range=${range}`),
					fetch(`${origin}/api/observability/history?type=rd&range=${range}`),
					fetch(`${origin}/api/observability/history?type=torrentio&range=${range}`),
				]);

				if (!streamResponse.ok) {
					throw new Error('Failed to fetch stream history data');
				}

				const streamJson = (await streamResponse.json()) as HistoryResponse<
					StreamHourlyData | StreamDailyData
				>;

				if (!isActive()) return;
				setStreamData(streamJson.data ?? []);
				setGranularity((streamJson.granularity as 'hourly' | 'daily') ?? 'hourly');

				if (rdResponse.ok) {
					const rdJson = (await rdResponse.json()) as HistoryResponse<
						RdHourlyData | RdDailyData
					>;
					if (!isActive()) return;
					setRdData(rdJson.data ?? []);
				}

				if (torrentioResponse.ok) {
					const torrentioJson = (await torrentioResponse.json()) as HistoryResponse<
						TorrentioHourlyData | TorrentioDailyData
					>;
					if (!isActive()) return;
					setTorrentioData(torrentioJson.data ?? []);
				}
			} catch (err) {
				if (!isActive()) return;
				console.error('Failed to fetch history:', err);
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

	// Format stream data for chart
	const streamChartData = (streamData ?? [])
		.map((item) => {
			const isHourly = 'hour' in item;
			const time = isHourly ? item.hour : item.date;

			return {
				time,
				workingRate: 'avgWorkingRate' in item ? item.avgWorkingRate : item.workingRate,
				avgLatencyMs: item.avgLatencyMs,
			};
		})
		.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

	// Format RD data for chart
	const rdChartData = (rdData ?? [])
		.map((item) => {
			const isHourly = 'hour' in item;
			const time = isHourly ? item.hour : item.date;

			return {
				time,
				successRate: 'avgSuccessRate' in item ? item.avgSuccessRate : item.successRate,
				totalCount: item.totalCount,
			};
		})
		.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

	// Format Torrentio data for chart
	const torrentioChartData = (torrentioData ?? [])
		.map((item) => {
			const isHourly = 'hour' in item;
			const time = isHourly ? item.hour : item.date;

			return {
				time,
				successRate: 'avgSuccessRate' in item ? item.avgSuccessRate : item.successRate,
				avgLatencyMs: item.avgLatencyMs,
			};
		})
		.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

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

	const hasStreamData = streamChartData.length > 0;
	const hasRdData = rdChartData.length > 0;
	const hasTorrentioData = torrentioChartData.length > 0;
	const hasData = hasStreamData || hasRdData || hasTorrentioData;

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
				<div className="flex gap-2">
					{rangeOptions.map((option) => (
						<button
							key={option.value}
							onClick={() => setRange(option.value)}
							className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
								range === option.value
									? 'bg-sky-600 text-white'
									: 'bg-slate-800 text-slate-300 hover:bg-slate-700'
							}`}
						>
							{option.label}
						</button>
					))}
				</div>
			</div>

			{!hasData ? (
				<div className="flex h-64 items-center justify-center">
					<div className="text-center text-slate-400">
						<BarChart3 className="mx-auto h-12 w-12 text-slate-600" />
						<p className="mt-3">No historical data available yet</p>
						<p className="mt-1 text-xs text-slate-500">
							Data will appear after the first aggregation runs
						</p>
					</div>
				</div>
			) : (
				<div className="space-y-6">
					{hasStreamData && (
						<div className="rounded-xl border border-white/10 bg-black/20 p-4">
							<h3 className="mb-4 text-sm font-medium text-slate-200">
								Stream Server Health
							</h3>
							<ResponsiveContainer width="100%" height={200}>
								<AreaChart data={streamChartData}>
									<defs>
										<linearGradient
											id="streamGradient"
											x1="0"
											y1="0"
											x2="0"
											y2="1"
										>
											<stop
												offset="5%"
												stopColor="#10b981"
												stopOpacity={0.3}
											/>
											<stop
												offset="95%"
												stopColor="#10b981"
												stopOpacity={0}
											/>
										</linearGradient>
									</defs>
									<CartesianGrid strokeDasharray="3 3" stroke="#334155" />
									<XAxis
										dataKey="time"
										tick={{ fill: '#94a3b8', fontSize: 10 }}
										tickLine={false}
										axisLine={{ stroke: '#475569' }}
										interval="preserveStartEnd"
										minTickGap={40}
										tickFormatter={formatTickLabel}
									/>
									<YAxis
										tick={{ fill: '#94a3b8', fontSize: 10 }}
										tickLine={false}
										axisLine={{ stroke: '#475569' }}
										tickFormatter={(v) => formatPercent(v)}
										domain={[0, 1]}
									/>
									<Tooltip
										contentStyle={{
											backgroundColor: '#1e293b',
											border: '1px solid #334155',
											borderRadius: '8px',
										}}
										labelStyle={{ color: '#f1f5f9' }}
										labelFormatter={(_, payload) => {
											if (payload && payload.length > 0) {
												return formatTooltipLabel(payload[0].payload.time);
											}
											return '';
										}}
										formatter={(value) => [
											formatPercent(value as number),
											'Working Rate',
										]}
									/>
									<Area
										type="monotone"
										dataKey="workingRate"
										stroke="#10b981"
										fill="url(#streamGradient)"
										strokeWidth={2}
									/>
								</AreaChart>
							</ResponsiveContainer>
						</div>
					)}

					{hasRdData && (
						<div className="rounded-xl border border-white/10 bg-black/20 p-4">
							<h3 className="mb-4 text-sm font-medium text-slate-200">
								API Success Rate
							</h3>
							<ResponsiveContainer width="100%" height={200}>
								<AreaChart data={rdChartData}>
									<defs>
										<linearGradient id="rdGradient" x1="0" y1="0" x2="0" y2="1">
											<stop
												offset="5%"
												stopColor="#0ea5e9"
												stopOpacity={0.3}
											/>
											<stop
												offset="95%"
												stopColor="#0ea5e9"
												stopOpacity={0}
											/>
										</linearGradient>
									</defs>
									<CartesianGrid strokeDasharray="3 3" stroke="#334155" />
									<XAxis
										dataKey="time"
										tick={{ fill: '#94a3b8', fontSize: 10 }}
										tickLine={false}
										axisLine={{ stroke: '#475569' }}
										interval="preserveStartEnd"
										minTickGap={40}
										tickFormatter={formatTickLabel}
									/>
									<YAxis
										tick={{ fill: '#94a3b8', fontSize: 10 }}
										tickLine={false}
										axisLine={{ stroke: '#475569' }}
										tickFormatter={(v) => formatPercent(v)}
										domain={[0, 1]}
									/>
									<Tooltip
										contentStyle={{
											backgroundColor: '#1e293b',
											border: '1px solid #334155',
											borderRadius: '8px',
										}}
										labelStyle={{ color: '#f1f5f9' }}
										labelFormatter={(_, payload) => {
											if (payload && payload.length > 0) {
												return formatTooltipLabel(payload[0].payload.time);
											}
											return '';
										}}
										formatter={(value) => [
											formatPercent(value as number),
											'Success Rate',
										]}
									/>
									<Area
										type="monotone"
										dataKey="successRate"
										stroke="#0ea5e9"
										fill="url(#rdGradient)"
										strokeWidth={2}
									/>
								</AreaChart>
							</ResponsiveContainer>
						</div>
					)}

					{hasTorrentioData && (
						<div className="rounded-xl border border-white/10 bg-black/20 p-4">
							<h3 className="mb-4 text-sm font-medium text-slate-200">
								Torrentio Resolver Health
							</h3>
							<ResponsiveContainer width="100%" height={200}>
								<AreaChart data={torrentioChartData}>
									<defs>
										<linearGradient
											id="torrentioGradient"
											x1="0"
											y1="0"
											x2="0"
											y2="1"
										>
											<stop
												offset="5%"
												stopColor="#f59e0b"
												stopOpacity={0.3}
											/>
											<stop
												offset="95%"
												stopColor="#f59e0b"
												stopOpacity={0}
											/>
										</linearGradient>
									</defs>
									<CartesianGrid strokeDasharray="3 3" stroke="#334155" />
									<XAxis
										dataKey="time"
										tick={{ fill: '#94a3b8', fontSize: 10 }}
										tickLine={false}
										axisLine={{ stroke: '#475569' }}
										interval="preserveStartEnd"
										minTickGap={40}
										tickFormatter={formatTickLabel}
									/>
									<YAxis
										tick={{ fill: '#94a3b8', fontSize: 10 }}
										tickLine={false}
										axisLine={{ stroke: '#475569' }}
										tickFormatter={(v) => formatPercent(v)}
										domain={[0, 1]}
									/>
									<Tooltip
										contentStyle={{
											backgroundColor: '#1e293b',
											border: '1px solid #334155',
											borderRadius: '8px',
										}}
										labelStyle={{ color: '#f1f5f9' }}
										labelFormatter={(_, payload) => {
											if (payload && payload.length > 0) {
												return formatTooltipLabel(payload[0].payload.time);
											}
											return '';
										}}
										formatter={(value) => [
											formatPercent(value as number),
											'Success Rate',
										]}
									/>
									<Area
										type="monotone"
										dataKey="successRate"
										stroke="#f59e0b"
										fill="url(#torrentioGradient)"
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
