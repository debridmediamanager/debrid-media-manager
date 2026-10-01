/**
 * Whether search can find what users actually stream.
 *
 * Search's hand-kept list of IMDb title types left out every direct-to-video
 * and TV film for nine months (2025-12-31 to 2026-09-29) before a user noticed
 * that the Futurama films could not be found. Nothing compared search with
 * demand. This does: every title streamed through a cast profile is checked
 * against the condition search itself uses, and a movie or show title enough
 * users streamed but search cannot offer is a defect to report.
 *
 * Two other kinds of miss are reported but never alert. A title IMDb's dump
 * does not carry (High Potential's tt26748649, which Cinemeta still serves) is
 * a gap in the source, not in search. Episodes, adult titles and games are
 * left out of search on purpose.
 */
import { isMovieTitleType, isShowTitleType } from '../utils/imdbTitleTypes';

export interface StreamedTitle {
	imdbId: string;
	/** Distinct users who streamed it, summed over the cast tables. */
	users: number;
	/** `null` when `imdb_title_basics` has no row for the id. */
	titleType: string | null;
	isAdult: boolean;
	/** Whether search's own condition admits the title. */
	searchable: boolean;
}

export type Bucket = 'searchable' | 'unsearchable' | 'not in IMDb dump' | 'excluded on purpose';

export function bucketOf(title: StreamedTitle): Bucket {
	if (title.titleType === null) return 'not in IMDb dump';
	if (title.searchable) return 'searchable';
	if (title.isAdult) return 'excluded on purpose';
	if (isMovieTitleType(title.titleType) || isShowTitleType(title.titleType))
		return 'unsearchable';
	return 'excluded on purpose';
}

export interface CoverageReport {
	titles: Record<Bucket, number>;
	streams: Record<Bucket, number>;
	/** Searchable streams over every stream of a title with a page. */
	share: number;
	/** The biggest misses in each reported bucket, most users first. */
	top: Record<'unsearchable' | 'not in IMDb dump', StreamedTitle[]>;
	alerts: string[];
}

export interface CoverageThresholds {
	/** An unsearchable title streamed by this many users alerts on its own. */
	minUsers: number;
	/** Alert when searchable streams fall under this share. */
	minShare: number;
}

/**
 * Over the 30 days to 2026-09-30, after the fixes, search found 99.56% of
 * streams and no unsearchable title had more than two users. Before them,
 * Finding Harry alone had 35 users who could not search for it.
 */
export const DEFAULT_THRESHOLDS: CoverageThresholds = { minUsers: 10, minShare: 0.99 };

export function summarizeCoverage(
	titles: StreamedTitle[],
	thresholds: CoverageThresholds = DEFAULT_THRESHOLDS
): CoverageReport {
	const zero = (): Record<Bucket, number> => ({
		searchable: 0,
		unsearchable: 0,
		'not in IMDb dump': 0,
		'excluded on purpose': 0,
	});
	const report: CoverageReport = {
		titles: zero(),
		streams: zero(),
		share: 1,
		top: { unsearchable: [], 'not in IMDb dump': [] },
		alerts: [],
	};
	for (const title of titles) {
		const bucket = bucketOf(title);
		report.titles[bucket]++;
		report.streams[bucket] += title.users;
		if (bucket === 'unsearchable' || bucket === 'not in IMDb dump')
			report.top[bucket].push(title);
	}
	for (const list of Object.values(report.top)) {
		list.sort((a, b) => b.users - a.users || a.imdbId.localeCompare(b.imdbId));
		list.splice(15);
	}

	const counted = report.streams.searchable + report.streams.unsearchable;
	report.share = counted === 0 ? 1 : report.streams.searchable / counted;

	for (const title of report.top.unsearchable) {
		if (title.users >= thresholds.minUsers) {
			report.alerts.push(
				`${title.imdbId} (${title.titleType}) was streamed by ${title.users} users but search cannot find it`
			);
		}
	}
	if (report.share < thresholds.minShare) {
		report.alerts.push(
			`search finds ${(report.share * 100).toFixed(1)}% of streamed titles, under ${(thresholds.minShare * 100).toFixed(0)}%`
		);
	}
	return report;
}
