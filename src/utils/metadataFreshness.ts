/**
 * How long a cached metadata row may be served before it is refetched.
 *
 * A title's rating, synopsis and artwork move for a while after it appears and
 * then stop moving. One flat TTL cannot serve both halves of that: 30 days keeps
 * a release-week IMDb score on screen for a month after the real one has settled,
 * and a TTL short enough to fix that would refetch titles from the 1990s that
 * have not changed in years. So the TTL is chosen from the payload already in the
 * cache — recent or unreleased titles, and shows that are still airing, get the
 * short one, and everything else keeps the long one it always had.
 */

export const RECENT_METADATA_TTL = 6 * 60 * 60 * 1000; // 6 hours

/** How long after its last known date a title is still treated as moving. */
export const RECENT_METADATA_WINDOW_MS = 730 * 24 * 60 * 60 * 1000; // ~2 years

// A show in one of these states gains episodes, ratings and season rows whatever
// its first-air date says. mdblist and Cinemeta spell the same state differently,
// and mdblist reuses the field for unreleased movies.
const ONGOING_STATUSES = new Set([
	'returning series',
	'continuing',
	'in production',
	'post production',
	'planned',
	'pilot',
	'upcoming',
	'ongoing',
]);

// "2008–2013" is a finished run, "2022–" an open one. Cinemeta writes the dash as
// an en dash; nothing guarantees the other sources do.
const YEAR_RANGE = /^(\d{4})\s*[-–—]\s*(\d{4})?$/;

export type ReleaseSignals = {
	/** First release / first air date, however the source spells a date. */
	released?: string | null;
	/** A year, or a year range: 1994, '2026', '2008–2013', '2022–'. */
	year?: string | number | null;
	/** Production status, in the source's own wording. */
	status?: string | null;
	/**
	 * Newest episode date the payload knows, aired or scheduled. Present only for
	 * shows, and authoritative for them: nothing else in the payload is checked
	 * when it is set.
	 */
	latestEpisode?: string | null;
};

const parseTimestamp = (value?: string | null): number | null => {
	if (!value) return null;
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? null : parsed;
};

const parseYearSignal = (
	value?: string | number | null
): { endYear: number | null; openEnded: boolean } => {
	if (value === null || value === undefined) return { endYear: null, openEnded: false };
	if (typeof value === 'number') {
		return { endYear: Number.isFinite(value) ? value : null, openEnded: false };
	}

	const trimmed = value.trim();
	const range = YEAR_RANGE.exec(trimmed);
	if (range) {
		return range[2]
			? { endYear: Number(range[2]), openEnded: false }
			: { endYear: Number(range[1]), openEnded: true };
	}

	return /^\d{4}$/.test(trimmed)
		? { endYear: Number(trimmed), openEnded: false }
		: { endYear: null, openEnded: false };
};

/** The newest of a set of dates, or null when the payload carries none. */
const latestDate = (values: unknown[]): string | null => {
	let latest: { value: string; at: number } | null = null;
	for (const value of values) {
		if (typeof value !== 'string') continue;
		const at = parseTimestamp(value);
		if (at === null) continue;
		if (!latest || at > latest.at) latest = { value, at };
	}
	return latest?.value ?? null;
};

/**
 * Whether a title's metadata is still changing often enough to be worth
 * refetching. Unknown dates count as settled: that is the behaviour every such
 * row had before this rule existed, and guessing the other way would refetch the
 * whole undated long tail for nothing.
 */
export function isMetadataStillMoving(signals: ReleaseSignals, now: number = Date.now()): boolean {
	const cutoff = now - RECENT_METADATA_WINDOW_MS;

	// A show is judged by the newest episode it knows about — aired or scheduled —
	// and by nothing else. Its first air date says nothing about whether anything
	// is still changing, and `status` and the year range are labels that go stale
	// while the episode list does not: Cinemeta still calls True Detective
	// "Continuing" with an open-ended "2014–" two and a half years after its last
	// episode, and would have had it refetched every six hours forever.
	const latestEpisode = parseTimestamp(signals.latestEpisode);
	if (latestEpisode !== null) return latestEpisode >= cutoff;

	// Everything below answers for a title with no episode list at all: a movie,
	// or a show announced before it has any dated episodes.
	const status = signals.status?.trim().toLowerCase();
	if (status && ONGOING_STATUSES.has(status)) return true;

	const { endYear, openEnded } = parseYearSignal(signals.year);
	if (openEnded) return true;

	// A date in the future is a title that has not landed yet, which is exactly
	// when the cached row is a placeholder synopsis and a teaser poster.
	const released = parseTimestamp(signals.released);
	if (released !== null) return released >= cutoff;

	// Year granularity only: the year counts as recent until it ends, which errs
	// toward refetching rather than toward serving a stale rating.
	if (endYear !== null) return Date.UTC(endYear, 11, 31) >= cutoff;

	return false;
}

/** `settledMaxAge` for a title that has stopped moving, the short TTL for one that has not. */
export function metadataMaxAge(
	signals: ReleaseSignals,
	settledMaxAge: number,
	now?: number
): number {
	if (settledMaxAge === 0) return 0; // permanent by the caller's choice
	return isMetadataStillMoving(signals, now)
		? Math.min(RECENT_METADATA_TTL, settledMaxAge)
		: settledMaxAge;
}

/**
 * Release signals out of an mdblist title payload.
 *
 * mdblist dates a season, not an episode, so `latestEpisode` here is the newest
 * season's first air date — up to a season early for a show that has just
 * finished. Cinemeta's per-episode dates are exact, and both caches decide
 * their own row's lifetime, so the approximation only ever costs this one row a
 * late refresh.
 */
export function mdblistReleaseSignals(data: any): ReleaseSignals {
	const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
	return {
		released: typeof data?.released === 'string' ? data.released : null,
		year: data?.year ?? null,
		status: typeof data?.status === 'string' ? data.status : null,
		latestEpisode: latestDate(seasons.map((season: any) => season?.air_date)),
	};
}

/** Release signals out of a Cinemeta `meta` object. */
export function cinemetaReleaseSignals(meta: any): ReleaseSignals {
	const videos = Array.isArray(meta?.videos) ? meta.videos : [];
	return {
		released: typeof meta?.released === 'string' ? meta.released : null,
		year: meta?.releaseInfo ?? meta?.year ?? null,
		status: typeof meta?.status === 'string' ? meta.status : null,
		latestEpisode: latestDate(videos.map((video: any) => video?.firstAired ?? video?.released)),
	};
}
