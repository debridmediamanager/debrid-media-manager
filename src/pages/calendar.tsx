import Poster from '@/components/poster';
import Head from 'next/head';
import Link from 'next/link';
import {
	memo,
	MouseEvent,
	useCallback,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { List } from 'react-window';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type CalendarEvent = {
	title: string;
	season: number | null;
	episode: number | null;
	firstAired: string;
	isPremiere: boolean;
	ids: Record<string, string | number>;
	network?: string;
	country?: string;
	// Pre-computed fields for performance
	_sortKey?: number;
	_imdbId?: string;
};

type CalendarDay = {
	date: string;
	items: CalendarEvent[];
};

type TmdbShow = {
	id: number;
	name: string;
	first_air_date?: string;
	poster_path?: string;
	next_episode_to_air?: {
		season_number?: number;
		episode_number?: number;
		air_date?: string;
	};
};

type CalendarResponse = {
	range: { start: string; days: number };
	days: CalendarDay[];
	tmdb: {
		airingToday: TmdbShow[];
		onTheAir: TmdbShow[];
	};
};

type ProcessedDay = {
	date: string;
	items: CalendarEvent[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants & Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

const EPISODE_CARD_HEIGHT = 140; // Height of each episode card in pixels (including gap)
const DMM_BASE_URL = 'https://debridmediamanager.com';

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

const isoDaysAgo = (days: number) => {
	const d = new Date();
	d.setDate(d.getDate() - days);
	return toIsoDate(d);
};

const formatDayLabel = (isoDate: string) =>
	new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(
		new Date(isoDate)
	);

const formatEpisodeCode = (season: number | null, episode: number | null) => {
	if (season == null || episode == null) return 'Ep TBD';
	const paddedSeason = String(season).padStart(2, '0');
	const paddedEpisode = String(episode).padStart(2, '0');
	return `S${paddedSeason}E${paddedEpisode}`;
};

const getEpisodeCode = (season: number | null, episode: number | null) =>
	season == null || episode == null ? '' : formatEpisodeCode(season, episode);

const formatIcsDate = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, '');

const escapeIcsText = (text: string) =>
	text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

const buildEventTitle = (event: CalendarEvent) => {
	const episodeCode = getEpisodeCode(event.season, event.episode);
	const base = episodeCode ? `${event.title} (${episodeCode})` : event.title;
	return `DMM: ${base}`;
};

const buildGoogleCalendarUrl = (
	title: string,
	start: Date,
	end: Date,
	timeZone: string,
	details?: string
) => {
	const dates = `${formatIcsDate(start)}/${formatIcsDate(end)}`;
	const params = new URLSearchParams({
		action: 'TEMPLATE',
		text: title,
		dates,
		ctz: timeZone || 'UTC',
	});
	if (details) params.set('details', details);
	return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Search Matching (optimized - regex compiled once per search)
// ─────────────────────────────────────────────────────────────────────────────

const createSearchMatcher = (terms: string[]) => {
	if (terms.length === 0) return () => true;

	// Pre-compile regexes once
	const matchers = terms.map((term) => {
		const q = term.toLowerCase();
		try {
			return { regex: new RegExp(q, 'i'), fallback: q };
		} catch {
			return { regex: null, fallback: q };
		}
	});

	return (event: CalendarEvent) => {
		const episodeCode = getEpisodeCode(event.season, event.episode);
		const imdbId = event._imdbId || '';
		const title = event.title || '';
		const network = event.network || '';

		return matchers.every(({ regex, fallback }) => {
			if (regex) {
				return (
					regex.test(title) ||
					regex.test(network) ||
					(episodeCode && regex.test(episodeCode)) ||
					(imdbId && regex.test(imdbId))
				);
			}
			const q = fallback;
			return (
				title.toLowerCase().includes(q) ||
				network.toLowerCase().includes(q) ||
				(episodeCode && episodeCode.toLowerCase().includes(q)) ||
				(imdbId && imdbId.toLowerCase().includes(q))
			);
		});
	};
};

// ─────────────────────────────────────────────────────────────────────────────
// Data Processing (pre-compute sort keys and cache IMDB IDs)
// ─────────────────────────────────────────────────────────────────────────────

const processCalendarData = (data: CalendarResponse): ProcessedDay[] => {
	return data.days.map((day) => {
		// Pre-compute sort keys and filter invalid items ONCE
		const processedItems = day.items
			.map((item) => ({
				...item,
				_sortKey: new Date(item.firstAired).getTime(),
				_imdbId: typeof item.ids?.imdb === 'string' ? String(item.ids.imdb) : '',
			}))
			.filter((item) => item._imdbId) // Only keep linkable items
			.sort((a, b) => {
				if (a._sortKey !== b._sortKey) return a._sortKey - b._sortKey;
				return (a.title || '').localeCompare(b.title || '');
			});

		return { date: day.date, items: processedItems };
	});
};

// ─────────────────────────────────────────────────────────────────────────────
// Memoized Episode Card Component
// ─────────────────────────────────────────────────────────────────────────────

const badgeClasses = 'rounded px-2 py-0.5 text-xs font-semibold';

type EpisodeCardProps = {
	item: CalendarEvent;
	showPath: string;
	showGoogleAdd: boolean;
	showAppleAdd: boolean;
	timeZone: string;
	onGoogleCalendar: (item: CalendarEvent, showPath: string) => void;
	onAppleCalendar: (item: CalendarEvent, showPath: string) => void;
};

const EpisodeCard = memo(function EpisodeCard({
	item,
	showPath,
	showGoogleAdd,
	showAppleAdd,
	timeZone,
	onGoogleCalendar,
	onAppleCalendar,
}: EpisodeCardProps) {
	const imdbId = item._imdbId || (item.ids?.imdb as string);

	const handleGoogleClick = useCallback(
		(e: MouseEvent<HTMLButtonElement>) => {
			e.preventDefault();
			e.stopPropagation();
			onGoogleCalendar(item, showPath);
		},
		[item, showPath, onGoogleCalendar]
	);

	const handleAppleClick = useCallback(
		(e: MouseEvent<HTMLButtonElement>) => {
			e.preventDefault();
			e.stopPropagation();
			onAppleCalendar(item, showPath);
		},
		[item, showPath, onAppleCalendar]
	);

	const localTime = useMemo(() => {
		return new Date(item.firstAired).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
		});
	}, [item.firstAired]);

	return (
		<Link href={showPath} className="block">
			<div className="rounded-xl border border-gray-800 bg-gray-900/80 px-2 py-2 hover:border-cyan-500/60">
				<div className="flex gap-3">
					<div className="w-16 flex-shrink-0 sm:w-20">
						<Poster imdbId={imdbId} title={item.title || ''} />
					</div>
					<div className="flex flex-1 flex-col justify-between gap-1">
						<div className="flex items-start justify-between gap-2">
							<div className="flex flex-col">
								<span className="text-sm font-semibold text-white">
									{item.title}
								</span>
								<span className="text-xs text-gray-400">
									{formatEpisodeCode(item.season, item.episode)}
									{item.network ? ` • ${item.network}` : ''}
								</span>
							</div>
							{item.isPremiere && (
								<span className={`${badgeClasses} bg-amber-900/70 text-amber-100`}>
									Premiere
								</span>
							)}
						</div>
						{(showGoogleAdd || showAppleAdd) && (
							<div className="flex flex-wrap items-center gap-2 text-[11px]">
								{showGoogleAdd && (
									<button
										onClick={handleGoogleClick}
										className="haptic-sm rounded-full border border-cyan-700/60 bg-cyan-900/30 px-2.5 py-1 font-semibold text-cyan-100 transition hover:border-cyan-400/80 hover:bg-cyan-800/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
									>
										Add to Google
									</button>
								)}
								{showAppleAdd && (
									<button
										onClick={handleAppleClick}
										className="haptic-sm rounded-full border border-gray-700 bg-gray-800/70 px-2.5 py-1 font-semibold text-gray-100 transition hover:border-cyan-400/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
									>
										Apple / .ics
									</button>
								)}
							</div>
						)}
						<p className="text-xs text-gray-400">{localTime} (local)</p>
					</div>
				</div>
			</div>
		</Link>
	);
});

// ─────────────────────────────────────────────────────────────────────────────
// Virtualized Row Component for react-window v2
// ─────────────────────────────────────────────────────────────────────────────

type VirtualRowExtraProps = {
	items: CalendarEvent[];
	showGoogleAdd: boolean;
	showAppleAdd: boolean;
	timeZone: string;
	onGoogleCalendar: (item: CalendarEvent, showPath: string) => void;
	onAppleCalendar: (item: CalendarEvent, showPath: string) => void;
};

// react-window v2 injects index, style, and ariaAttributes
function VirtualRow({
	index,
	style,
	items,
	showGoogleAdd,
	showAppleAdd,
	timeZone,
	onGoogleCalendar,
	onAppleCalendar,
}: {
	index: number;
	style: React.CSSProperties;
	ariaAttributes?: Record<string, unknown>;
} & VirtualRowExtraProps) {
	const item = items[index];
	const imdbId = item._imdbId || (item.ids?.imdb as string);
	const seasonPath = item.season ? item.season : 1;
	const showPath = `/show/${imdbId}/${seasonPath}`;

	// Leave space at the bottom of each row for gap (8px)
	const rowStyle: React.CSSProperties = {
		...style,
		height: typeof style.height === 'number' ? style.height - 8 : style.height,
	};

	return (
		<div style={rowStyle}>
			<EpisodeCard
				item={item}
				showPath={showPath}
				showGoogleAdd={showGoogleAdd}
				showAppleAdd={showAppleAdd}
				timeZone={timeZone}
				onGoogleCalendar={onGoogleCalendar}
				onAppleCalendar={onAppleCalendar}
			/>
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Virtualized Day Column Component
// ─────────────────────────────────────────────────────────────────────────────

type DayColumnProps = {
	day: ProcessedDay;
	isToday: boolean;
	showGoogleAdd: boolean;
	showAppleAdd: boolean;
	timeZone: string;
	onGoogleCalendar: (item: CalendarEvent, showPath: string) => void;
	onAppleCalendar: (item: CalendarEvent, showPath: string) => void;
	dayRef: (node: HTMLElement | null) => void;
};

const DayColumn = memo(function DayColumn({
	day,
	isToday,
	showGoogleAdd,
	showAppleAdd,
	timeZone,
	onGoogleCalendar,
	onAppleCalendar,
	dayRef,
}: DayColumnProps) {
	const items = day.items;
	const containerRef = useRef<HTMLDivElement>(null);
	const [containerHeight, setContainerHeight] = useState(400);

	// Measure available height for virtualization
	useEffect(() => {
		const updateHeight = () => {
			if (containerRef.current) {
				// Calculate available height (viewport - header - padding)
				const viewportHeight = window.innerHeight;
				const containerTop = containerRef.current.getBoundingClientRect().top;
				const availableHeight = Math.max(300, viewportHeight - containerTop - 60);
				setContainerHeight(availableHeight);
			}
		};

		updateHeight();
		window.addEventListener('resize', updateHeight);
		return () => window.removeEventListener('resize', updateHeight);
	}, []);

	// Decide whether to virtualize based on item count
	const shouldVirtualize = items.length > 10;

	// Memoize row props for virtualization
	const rowProps: VirtualRowExtraProps = useMemo(
		() => ({
			items,
			showGoogleAdd,
			showAppleAdd,
			timeZone,
			onGoogleCalendar,
			onAppleCalendar,
		}),
		[items, showGoogleAdd, showAppleAdd, timeZone, onGoogleCalendar, onAppleCalendar]
	);

	return (
		<section
			ref={(node) => {
				dayRef(node);
			}}
			className={`min-w-[240px] max-w-xs flex-shrink-0 snap-start rounded-2xl border border-gray-800/80 p-3 shadow-sm transition-colors sm:min-w-[280px] ${
				isToday ? 'bg-cyan-950/50' : 'bg-gray-800/75'
			}`}
		>
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<h3 className="text-lg font-semibold text-white">{formatDayLabel(day.date)}</h3>
					{isToday && (
						<span className="rounded bg-cyan-900/70 px-2 py-0.5 text-[11px] font-semibold uppercase text-cyan-100">
							Today
						</span>
					)}
				</div>
				<span className="text-xs text-gray-400">{items.length} episodes</span>
			</div>

			<div ref={containerRef} className="mt-3">
				{items.length === 0 && (
					<p className="text-xs text-gray-500">No linkable episodes for this day.</p>
				)}

				{items.length > 0 && shouldVirtualize ? (
					<List
						style={{ height: containerHeight }}
						rowComponent={VirtualRow as any}
						rowCount={items.length}
						rowHeight={EPISODE_CARD_HEIGHT}
						rowProps={rowProps as any}
						overscanCount={3}
					/>
				) : (
					<div className="space-y-2">
						{items.map((item) => {
							const imdbId = item._imdbId || (item.ids?.imdb as string);
							const seasonPath = item.season ? item.season : 1;
							const showPath = `/show/${imdbId}/${seasonPath}`;

							return (
								<EpisodeCard
									key={imdbId + '-' + item.season + '-' + item.episode}
									item={item}
									showPath={showPath}
									showGoogleAdd={showGoogleAdd}
									showAppleAdd={showAppleAdd}
									timeZone={timeZone}
									onGoogleCalendar={onGoogleCalendar}
									onAppleCalendar={onAppleCalendar}
								/>
							);
						})}
					</div>
				)}
			</div>
		</section>
	);
});

// ─────────────────────────────────────────────────────────────────────────────
// Main Calendar Page Component
// ─────────────────────────────────────────────────────────────────────────────

function CalendarPage() {
	const [startDate] = useState<string>(isoDaysAgo(7));
	const dayCount = 14;
	const todayIso = useMemo(() => toIsoDate(new Date()), []);
	const [data, setData] = useState<CalendarResponse | null>(null);
	const [loading, setLoading] = useState<boolean>(true);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState('');
	const [showGoogleAdd, setShowGoogleAdd] = useState(false);
	const [showAppleAdd, setShowAppleAdd] = useState(false);

	// Deferred search query for non-blocking UI
	const deferredQuery = useDeferredValue(query);

	const timeZone = useMemo(
		() =>
			typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function'
				? Intl.DateTimeFormat().resolvedOptions().timeZone
				: 'UTC',
		[]
	);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const dayRefs = useRef<Record<string, HTMLElement | null>>({});

	// ─────────────────────────────────────────────────────────────────────────
	// Data Fetching
	// ─────────────────────────────────────────────────────────────────────────

	useEffect(() => {
		let isMounted = true;
		setLoading(true);
		setError(null);

		const controller = new AbortController();

		(async () => {
			try {
				const query = new URLSearchParams({
					start: startDate,
					days: String(dayCount),
				}).toString();
				const resp = await fetch(`/api/calendar?${query}`, { signal: controller.signal });
				if (!resp.ok) {
					throw new Error('Calendar fetch failed');
				}
				const payload: CalendarResponse = await resp.json();
				if (!isMounted) return;
				setData(payload);
			} catch (err: any) {
				if (err.name === 'AbortError') return;
				console.error('Failed to load calendar', err);
				if (!isMounted) return;
				setError('Could not load calendar data.');
			} finally {
				if (isMounted) setLoading(false);
			}
		})();

		return () => {
			isMounted = false;
			controller.abort();
		};
	}, [startDate, dayCount]);

	// Settings effect
	useEffect(() => {
		if (typeof window === 'undefined') return;

		const refreshSetting = () => {
			try {
				const g = window.localStorage.getItem('settings:showCalendarAddButtonsGoogle');
				const a = window.localStorage.getItem('settings:showCalendarAddButtonsApple');
				setShowGoogleAdd(g === 'true');
				setShowAppleAdd(a === 'true');
			} catch {
				setShowGoogleAdd(false);
				setShowAppleAdd(false);
			}
		};

		refreshSetting();

		const handleStorage = (event: StorageEvent) => {
			if (
				event.key === 'settings:showCalendarAddButtonsGoogle' ||
				event.key === 'settings:showCalendarAddButtonsApple'
			) {
				refreshSetting();
			}
		};

		window.addEventListener('storage', handleStorage);
		return () => window.removeEventListener('storage', handleStorage);
	}, []);

	// ─────────────────────────────────────────────────────────────────────────
	// Pre-processed Data (computed once when data arrives)
	// ─────────────────────────────────────────────────────────────────────────

	const processedDays = useMemo(() => {
		if (!data) return [];
		return processCalendarData(data);
	}, [data]);

	// ─────────────────────────────────────────────────────────────────────────
	// Search Filtering (uses deferred value for non-blocking)
	// ─────────────────────────────────────────────────────────────────────────

	const queryTerms = useMemo(
		() => deferredQuery.toLowerCase().split(/\s+/).filter(Boolean),
		[deferredQuery]
	);

	const searchMatcher = useMemo(() => createSearchMatcher(queryTerms), [queryTerms]);

	const filteredDays = useMemo(() => {
		if (queryTerms.length === 0) return processedDays;

		return processedDays
			.map((day) => ({
				...day,
				items: day.items.filter(searchMatcher),
			}))
			.filter((day) => day.items.length > 0);
	}, [processedDays, queryTerms, searchMatcher]);

	// ─────────────────────────────────────────────────────────────────────────
	// Derived Values
	// ─────────────────────────────────────────────────────────────────────────

	const filteredEvents = useMemo(() => {
		return filteredDays.flatMap((day) =>
			day.items.map((item) => ({
				item,
				showPath: `/show/${item._imdbId}/${item.season || 1}`,
			}))
		);
	}, [filteredDays]);

	const totalLinkableEpisodes = useMemo(() => {
		return processedDays.reduce((sum, day) => sum + day.items.length, 0);
	}, [processedDays]);

	const calendarWindow = useMemo(() => {
		if (!data) return null;
		const endDate = new Date(data.range.start);
		endDate.setDate(endDate.getDate() + data.range.days - 1);
		return `${formatDayLabel(data.range.start)} - ${formatDayLabel(toIsoDate(endDate))}`;
	}, [data]);

	const hasSearch = queryTerms.length > 0;
	const isSearching = query !== deferredQuery;

	// ─────────────────────────────────────────────────────────────────────────
	// Event Handlers (stable references with useCallback)
	// ─────────────────────────────────────────────────────────────────────────

	const handleScrollToToday = useCallback(() => {
		const node = dayRefs.current[todayIso];
		const container = containerRef.current;
		if (node && container) {
			const offset = node.offsetLeft - (container.clientWidth - node.clientWidth) / 2;
			const clampedOffset = Math.min(
				Math.max(0, offset),
				container.scrollWidth - container.clientWidth
			);
			container.scrollTo({ left: clampedOffset, behavior: 'smooth' });
			return;
		}
		if (node) {
			node.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
		}
	}, [todayIso]);

	const handleGoogleCalendar = useCallback(
		(item: CalendarEvent, showPath: string) => {
			const start = new Date(item.firstAired);
			const end = new Date(start.getTime() + 60 * 60 * 1000);
			const eventTitle = buildEventTitle(item);
			const showUrl = new URL(showPath, DMM_BASE_URL).toString();
			const details = [item.network ? `Network: ${item.network}` : '', `Link: ${showUrl}`]
				.filter(Boolean)
				.join('\n');
			const url = buildGoogleCalendarUrl(eventTitle, start, end, timeZone, details);
			if (typeof window !== 'undefined') {
				window.open(url, '_blank', 'noopener,noreferrer');
			}
		},
		[timeZone]
	);

	const handleAppleCalendar = useCallback((item: CalendarEvent, showPath: string) => {
		const start = new Date(item.firstAired);
		const end = new Date(start.getTime() + 60 * 60 * 1000);
		const now = new Date();
		const eventTitle = buildEventTitle(item);
		const imdbId = item._imdbId || (item.ids?.imdb as string);
		const showUrl = new URL(showPath, DMM_BASE_URL).toString();
		const description = [item.network ? `Network: ${item.network}` : '', `Link: ${showUrl}`]
			.filter(Boolean)
			.join('\n');

		const icsLines = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//Debrid Media Manager//Calendar//EN',
			'BEGIN:VEVENT',
			`UID:${escapeIcsText(`${imdbId || item.title}-${formatIcsDate(start)}`)}`,
			`DTSTAMP:${formatIcsDate(now)}`,
			`DTSTART:${formatIcsDate(start)}`,
			`DTEND:${formatIcsDate(end)}`,
			`SUMMARY:${escapeIcsText(eventTitle || 'Episode')}`,
			description ? `DESCRIPTION:${escapeIcsText(description)}` : '',
			showUrl ? `URL:${escapeIcsText(showUrl)}` : '',
			'END:VEVENT',
			'END:VCALENDAR',
		].filter(Boolean);

		const icsBlob = new Blob([icsLines.join('\r\n')], {
			type: 'text/calendar;charset=utf-8',
		});
		const url = URL.createObjectURL(icsBlob);
		const filename =
			(eventTitle || 'episode').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'episode';
		const link = document.createElement('a');
		link.href = url;
		link.download = `${filename}.ics`;
		link.click();
		URL.revokeObjectURL(url);
	}, []);

	const handleExportFilteredIcs = useCallback(() => {
		if (filteredEvents.length === 0 || typeof window === 'undefined') return;

		const now = new Date();
		const icsLines = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//Debrid Media Manager//Calendar//EN',
		];

		for (const { item, showPath } of filteredEvents) {
			const start = new Date(item.firstAired);
			const end = new Date(start.getTime() + 60 * 60 * 1000);
			const showUrl = new URL(showPath, DMM_BASE_URL).toString();
			const description = [item.network ? `Network: ${item.network}` : '', `Link: ${showUrl}`]
				.filter(Boolean)
				.join('\n');

			icsLines.push(
				'BEGIN:VEVENT',
				`UID:${escapeIcsText(`${item._imdbId || item.title}-${formatIcsDate(start)}`)}`,
				`DTSTAMP:${formatIcsDate(now)}`,
				`DTSTART:${formatIcsDate(start)}`,
				`DTEND:${formatIcsDate(end)}`,
				`SUMMARY:${escapeIcsText(buildEventTitle(item))}`,
				description ? `DESCRIPTION:${escapeIcsText(description)}` : '',
				showUrl ? `URL:${escapeIcsText(showUrl)}` : '',
				'END:VEVENT'
			);
		}

		icsLines.push('END:VCALENDAR');

		const icsBlob = new Blob([icsLines.filter(Boolean).join('\r\n')], {
			type: 'text/calendar;charset=utf-8',
		});
		const url = URL.createObjectURL(icsBlob);
		const link = document.createElement('a');
		link.href = url;
		const filenameParts = ['dmm-calendar-filtered'];
		if (calendarWindow) filenameParts.push(calendarWindow.replace(/[^a-z0-9]+/gi, '-'));
		link.download = `${filenameParts.join('-').replace(/-+/g, '-').toLowerCase()}.ics`;
		link.click();
		URL.revokeObjectURL(url);
	}, [filteredEvents, calendarWindow]);

	// Day ref setter factory (stable reference per day)
	const createDayRef = useCallback((date: string) => {
		return (node: HTMLElement | null) => {
			dayRefs.current[date] = node;
		};
	}, []);

	// ─────────────────────────────────────────────────────────────────────────
	// Render
	// ─────────────────────────────────────────────────────────────────────────

	return (
		<div className="flex min-h-screen flex-col bg-gray-900 px-3 pb-12 pt-4 text-gray-100 sm:px-4 lg:px-6">
			<Head>
				<title>Debrid Media Manager - Episode Calendar</title>
				<meta name="robots" content="noindex, nofollow" />
			</Head>

			<main className="mx-auto flex w-full flex-col gap-3">
				<section className="rounded-2xl border border-gray-800/80 bg-gray-900/80 p-3 shadow-lg shadow-black/25 sm:p-4">
					<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
						<div className="space-y-0.5">
							<h1 className="text-xl font-semibold text-white">Episode Calendar</h1>
							<p className="text-xs text-gray-400">
								{calendarWindow
									? `Window: ${calendarWindow} • ${totalLinkableEpisodes} episodes`
									: 'Loading calendar window...'}
							</p>
						</div>
						<div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:items-center">
							<button
								onClick={handleScrollToToday}
								className="haptic-sm inline-flex w-full items-center justify-center rounded-full border-2 border-cyan-500/70 bg-cyan-900/40 px-3 py-1.5 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-800/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 sm:w-auto"
							>
								Jump to Today
							</button>
							<Link
								href="/"
								className="haptic-sm inline-flex w-full items-center justify-center rounded-full border-2 border-gray-700 bg-gray-800/70 px-3 py-1.5 text-sm font-semibold text-gray-100 transition-colors hover:border-cyan-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 sm:w-auto"
							>
								Go Home
							</Link>
						</div>
					</div>
					<div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
						<div className="relative w-full sm:max-w-md">
							<svg
								className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
								fill="none"
								stroke="currentColor"
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<circle cx="11" cy="11" r="7" />
								<line x1="16.65" y1="16.65" x2="21" y2="21" />
							</svg>
							<input
								type="text"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder="Search title, network, S01E01, or IMDB id (regex ok)"
								className="w-full rounded-full border border-gray-700 bg-gray-800/70 px-3 py-2 pl-9 text-sm text-gray-100 placeholder-gray-500 shadow-inner focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-400 sm:py-1.5"
							/>
							{isSearching && (
								<div className="absolute right-3 top-1/2 -translate-y-1/2">
									<div className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
								</div>
							)}
						</div>
						<div className="flex flex-col gap-2 sm:flex-1 sm:flex-row sm:items-center sm:justify-between">
							{hasSearch && filteredEvents.length > 0 && (
								<button
									onClick={handleExportFilteredIcs}
									className="haptic-sm inline-flex items-center justify-center rounded-full border border-cyan-600/70 bg-cyan-900/40 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:border-cyan-400 hover:bg-cyan-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
								>
									Export filtered (.ics)
								</button>
							)}
						</div>
					</div>
				</section>

				{loading && (
					<div className="flex items-center justify-center">
						<div className="h-10 w-10 animate-spin rounded-full border-b-2 border-t-2 border-cyan-400"></div>
					</div>
				)}

				{error && <p className="text-sm text-red-300">{error}</p>}

				{!loading && !error && filteredDays.length === 0 && (
					<p className="text-sm text-gray-300">
						{hasSearch
							? 'No episodes match your search.'
							: 'No episodes scheduled in this window.'}
					</p>
				)}

				<div className="relative">
					<div
						ref={containerRef}
						className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4 pr-1 [-webkit-overflow-scrolling:touch]"
					>
						{filteredDays.map((day) => (
							<DayColumn
								key={day.date}
								day={day}
								isToday={day.date === todayIso}
								showGoogleAdd={showGoogleAdd}
								showAppleAdd={showAppleAdd}
								timeZone={timeZone}
								onGoogleCalendar={handleGoogleCalendar}
								onAppleCalendar={handleAppleCalendar}
								dayRef={createDayRef(day.date)}
							/>
						))}
					</div>
				</div>
			</main>

			<button
				onClick={handleScrollToToday}
				className="haptic-sm fixed bottom-4 right-4 z-30 inline-flex items-center justify-center rounded-full border-2 border-cyan-500/80 bg-cyan-900/80 px-4 py-2 text-sm font-semibold text-cyan-50 shadow-lg shadow-black/40 backdrop-blur transition hover:bg-cyan-800/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 md:hidden"
			>
				Today
			</button>
		</div>
	);
}

export default CalendarPage;
