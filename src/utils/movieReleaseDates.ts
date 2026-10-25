export type TmdbReleaseDate = {
	type: number;
	release_date?: string;
};

export type TmdbReleaseDateRegion = {
	iso_3166_1: string;
	release_dates: TmdbReleaseDate[];
};

export type TmdbReleaseDatesResponse = {
	results?: TmdbReleaseDateRegion[];
};

export type ExpectedDigitalReleaseSource = 'tmdb' | 'estimated';

const DIGITAL_RELEASE_TYPE = 4;
const THEATRICAL_TO_DIGITAL_ESTIMATE_DAYS = 45;

export function addDaysIso(date: string, days: number): string {
	const parsed = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return '';
	parsed.setUTCDate(parsed.getUTCDate() + days);
	return parsed.toISOString().slice(0, 10);
}

export function extractDigitalReleaseDate(releaseDates?: TmdbReleaseDatesResponse | null): string {
	const results = releaseDates?.results;
	if (!results?.length) return '';

	const orderedRegions = [
		results.find((region) => region.iso_3166_1 === 'US'),
		...results.filter((region) => region.iso_3166_1 !== 'US'),
	].filter((region): region is TmdbReleaseDateRegion => Boolean(region));

	for (const region of orderedRegions) {
		const digitalDates = region.release_dates
			.filter((date) => date.type === DIGITAL_RELEASE_TYPE && date.release_date)
			.map((date) => date.release_date!.slice(0, 10))
			.sort();
		if (digitalDates.length > 0) {
			return digitalDates[0];
		}
	}

	return '';
}

export function getExpectedDigitalReleaseDate(
	releaseDate?: string | null,
	digitalReleaseDate?: string | null
): {
	date: string;
	source: ExpectedDigitalReleaseSource | null;
} {
	if (digitalReleaseDate) {
		return { date: digitalReleaseDate, source: 'tmdb' };
	}

	if (releaseDate) {
		return {
			date: addDaysIso(releaseDate, THEATRICAL_TO_DIGITAL_ESTIMATE_DAYS),
			source: 'estimated',
		};
	}

	return { date: '', source: null };
}

export function isIsoDateOnOrBeforeToday(date?: string | null, today = new Date()): boolean {
	if (!date) return false;
	const parsed = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return false;
	const todayIso = today.toISOString().slice(0, 10);
	return date <= todayIso;
}

export function formatReleaseDate(date?: string | null): string {
	if (!date) return '';
	const parsed = new Date(`${date}T12:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return date;
	return parsed.toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	});
}

/** Older than this, a film is out digitally whatever TMDB's dates claim. */
const LONG_RELEASED_YEARS = 2;

export type MovieReleaseFields = {
	year?: string;
	expectedDigitalReleaseDate?: string;
	expectedDigitalReleaseSource?: ExpectedDigitalReleaseSource | null;
	digitalReleaseAvailable?: boolean;
};

/**
 * Whether the film can be had digitally. TMDB's dates are often wrong for old
 * films (The Godfather, 1972: digital Sep 13, 2026; The Wizard of Oz: an
 * estimate of Oct 5, 1939), so a film whose year is long past counts as out.
 */
export function isMovieDigitallyReleased(info: MovieReleaseFields, today = new Date()): boolean {
	if (info.digitalReleaseAvailable) return true;
	const year = parseInt(info.year ?? '', 10);
	if (!Number.isNaN(year) && year < today.getUTCFullYear() - LONG_RELEASED_YEARS) return true;
	return isIsoDateOnOrBeforeToday(info.expectedDigitalReleaseDate, today);
}

/**
 * The header chip for a digital release still to come: `Digital Nov 17, 2026`,
 * or `Digital ~Jan 29, 2027` for an estimate. Null once the film is out.
 */
export function upcomingDigitalRelease(
	info: MovieReleaseFields,
	today = new Date()
): { label: string; title: string } | null {
	if (!info.expectedDigitalReleaseDate || isMovieDigitallyReleased(info, today)) return null;
	const date = formatReleaseDate(info.expectedDigitalReleaseDate);
	if (info.expectedDigitalReleaseSource === 'estimated') {
		return {
			label: `Digital ~${date}`,
			title: `Expected digital release ${date}: an estimate, 45 days after the theatrical release, as TMDB has no digital date yet`,
		};
	}
	return { label: `Digital ${date}`, title: `Digital release ${date}, from TMDB` };
}
