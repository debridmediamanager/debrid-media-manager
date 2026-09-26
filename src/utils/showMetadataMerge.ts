/**
 * One show, as six providers describe it, reduced to the single answer
 * `/api/info/show` returns.
 *
 * The providers disagree about more than episode counts. When a show changes
 * network, TMDB, Trakt and mdblist start a second entry and number its seasons
 * from 1 again, while TVmaze, OMDb and Cinemeta keep counting: The Great British
 * Bake Off (tt1877368) is 7 seasons and "Canceled" on the first three and 17
 * seasons, airing, on the other three. TVmaze in turn answers some IMDb ids with
 * a related show whose seasons are numbered by year — tt0115147, The Daily Show,
 * resolves to the Trevor Noah run, seasons 2015 to 2022, "Ended" — while the
 * show itself is on season 31 and still airing.
 *
 * So no provider is trusted on its own. Every one is reduced to a `ShowView`,
 * the season list is the union of them all, and the status and the next and last
 * episodes come from whichever provider's view reaches furthest into that list:
 * the provider that knows about the latest season is the one describing the show
 * as it is now.
 */

export type ShowSource = 'tmdb' | 'tvmaze' | 'trakt' | 'mdblist' | 'cinemeta' | 'omdb';

export type ShowEpisode = {
	first_aired: string;
	episode_number: number;
	season_number: number;
	name: string;
};

export type ShowView = {
	source: ShowSource;
	/** Season number to episode count, or null where the provider lists the season but no count. */
	seasons: Map<number, number | null>;
	/** In TMDB's vocabulary, which is the one the season page renders. */
	status?: string;
	next?: ShowEpisode;
	last?: ShowEpisode;
};

export type MergedShowMetadata = {
	season_count: number;
	season_episode_counts: Record<number, number>;
	has_specials: boolean;
	status?: string;
	next_episode_to_air?: ShowEpisode;
	last_episode_to_air?: ShowEpisode;
	/** Highest season each provider reached, for the request log. */
	reach: Partial<Record<ShowSource, number>>;
};

// When two views reach equally far, the earlier source here wins. TMDB leads
// because the season page's status badges are written in its vocabulary.
const SOURCE_PRIORITY: ShowSource[] = ['tmdb', 'tvmaze', 'trakt', 'mdblist', 'cinemeta', 'omdb'];

// No real season is numbered like a year. A view with one is numbering by air
// year, and — as with TVmaze's Daily Show — is usually describing a different
// entry altogether, so none of it is used.
const YEAR_NUMBERED_SEASON = 1900;

const STATUS_VOCABULARY: Record<string, string> = {
	'returning series': 'Returning Series',
	continuing: 'Returning Series',
	running: 'Returning Series',
	ended: 'Ended',
	canceled: 'Canceled',
	cancelled: 'Canceled',
	'in production': 'In Production',
	'in development': 'In Production',
	'post production': 'In Production',
	planned: 'Planned',
	upcoming: 'Planned',
	pilot: 'Pilot',
};

/** A provider's status in TMDB's words, or undefined for one that has no equivalent. */
export function normalizeShowStatus(status: unknown): string | undefined {
	if (typeof status !== 'string') return undefined;
	return STATUS_VOCABULARY[status.trim().toLowerCase()];
}

const asSeasonNumber = (value: unknown): number | null => {
	const n = typeof value === 'string' ? Number(value) : value;
	return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
};

const asCount = (value: unknown): number | null => {
	const n = typeof value === 'string' ? Number(value) : value;
	return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

const addSeason = (seasons: Map<number, number | null>, season: unknown, count: unknown) => {
	const number = asSeasonNumber(season);
	if (number === null) return;
	const episodes = asCount(count);
	const known = seasons.get(number) ?? null;
	seasons.set(number, known === null ? episodes : Math.max(known, episodes ?? 0));
};

const episode = (
	season: unknown,
	number: unknown,
	aired: unknown,
	name: unknown
): ShowEpisode | undefined => {
	const season_number = asSeasonNumber(season);
	const episode_number = asSeasonNumber(number);
	if (season_number === null || episode_number === null) return undefined;
	if (typeof aired !== 'string' || !aired) return undefined;
	return {
		first_aired: aired,
		episode_number,
		season_number,
		name: typeof name === 'string' ? name : '',
	};
};

const list = (value: unknown): any[] => (Array.isArray(value) ? value : []);

/** mdblist's title payload: TMDB's seasons, as mdblist mirrors them. */
export function viewFromMdblist(data: any): ShowView | null {
	if (!data || typeof data !== 'object') return null;
	const seasons = new Map<number, number | null>();
	for (const season of list(data.seasons)) {
		addSeason(seasons, season?.season_number, season?.episode_count);
	}
	return { source: 'mdblist', seasons, status: normalizeShowStatus(data.status) };
}

/** Cinemeta's series meta: one video per episode, specials as season 0. */
export function viewFromCinemeta(data: any): ShowView | null {
	const meta = data?.meta;
	if (!meta || typeof meta !== 'object') return null;
	const counts = new Map<number, number>();
	for (const video of list(meta.videos)) {
		const season = asSeasonNumber(video?.season);
		if (season === null) continue;
		counts.set(season, (counts.get(season) ?? 0) + 1);
	}
	const seasons = new Map<number, number | null>(counts);
	return { source: 'cinemeta', seasons, status: normalizeShowStatus(meta.status) };
}

/** TMDB's `/tv/{id}`. */
export function viewFromTmdb(data: any): ShowView | null {
	if (!data || typeof data !== 'object') return null;
	const seasons = new Map<number, number | null>();
	for (const season of list(data.seasons)) {
		addSeason(seasons, season?.season_number, season?.episode_count);
	}
	const next = data.next_episode_to_air;
	const last = data.last_episode_to_air;
	return {
		source: 'tmdb',
		seasons,
		status: normalizeShowStatus(data.status),
		next: next
			? episode(next.season_number, next.episode_number, next.air_date, next.name)
			: undefined,
		last: last
			? episode(last.season_number, last.episode_number, last.air_date, last.name)
			: undefined,
	};
}

/** Trakt's `/shows/{id}/seasons?extended=full`, with its next and last episode. */
export function viewFromTrakt(seasonsData: any, next: any, last: any): ShowView | null {
	const seasons = new Map<number, number | null>();
	for (const season of list(seasonsData)) {
		addSeason(seasons, season?.number, season?.episode_count);
	}
	const nextEpisode = next
		? episode(next.season, next.number, next.first_aired, next.title)
		: undefined;
	const lastEpisode = last
		? episode(last.season, last.number, last.first_aired, last.title)
		: undefined;
	if (seasons.size === 0 && !nextEpisode && !lastEpisode) return null;
	return { source: 'trakt', seasons, next: nextEpisode, last: lastEpisode };
}

/** TVmaze's `/shows/{id}` with `seasons`, `nextepisode` and `previousepisode` embedded. */
export function viewFromTvmaze(data: any): ShowView | null {
	if (!data || typeof data !== 'object') return null;
	const embedded = data._embedded ?? {};
	const seasons = new Map<number, number | null>();
	for (const season of list(embedded.seasons)) {
		addSeason(seasons, season?.number, season?.episodeOrder);
	}
	const next = embedded.nextepisode;
	const previous = embedded.previousepisode;
	return {
		source: 'tvmaze',
		seasons,
		status: normalizeShowStatus(data.status),
		next: next
			? episode(next.season, next.number, next.airstamp ?? next.airdate, next.name)
			: undefined,
		last: previous
			? episode(
					previous.season,
					previous.number,
					previous.airstamp ?? previous.airdate,
					previous.name
				)
			: undefined,
	};
}

/** OMDb's title payload, which knows how many seasons there are and nothing more. */
export function viewFromOmdb(data: any): ShowView | null {
	const total = asCount(data?.totalSeasons);
	if (!total) return null;
	const seasons = new Map<number, number | null>();
	for (let season = 1; season <= total; season++) seasons.set(season, null);
	return { source: 'omdb', seasons };
}

/** The highest real season a view knows, 0 for none, or -1 for a view numbered by year. */
function reachOf(view: ShowView): number {
	let highest = 0;
	for (const season of view.seasons.keys()) {
		if (season >= YEAR_NUMBERED_SEASON) return -1;
		if (season > highest) highest = season;
	}
	return highest;
}

const priority = (view: ShowView) => SOURCE_PRIORITY.indexOf(view.source);

// A timestamp renders as a time on the season page; a bare date renders as
// midnight UTC. Between two answers for the same episode, keep the exact one.
const hasTime = (value: string) => value.includes('T');

function pickEpisode(candidates: ShowEpisode[]): ShowEpisode | undefined {
	return candidates.reduce<ShowEpisode | undefined>((best, candidate) => {
		if (!best) return candidate;
		if (candidate.season_number !== best.season_number) {
			return candidate.season_number > best.season_number ? candidate : best;
		}
		if (candidate.episode_number !== best.episode_number) {
			return candidate.episode_number > best.episode_number ? candidate : best;
		}
		return !hasTime(best.first_aired) && hasTime(candidate.first_aired) ? candidate : best;
	}, undefined);
}

export function mergeShowViews(views: Array<ShowView | null | undefined>): MergedShowMetadata {
	const usable = views
		.filter((view): view is ShowView => !!view)
		.map((view) => ({ view, reach: reachOf(view) }))
		.filter(({ reach }) => reach >= 0);

	const counts: Record<number, number> = {};
	let has_specials = false;
	let season_count = 0;
	for (const { view, reach } of usable) {
		season_count = Math.max(season_count, reach);
		for (const [season, episodes] of view.seasons) {
			if (season === 0) has_specials = true;
			counts[season] = Math.max(counts[season] ?? 0, episodes ?? 0);
		}
	}

	// Most recent first; among equals, the source the season page's vocabulary
	// comes from.
	const byReach = [...usable].sort(
		(a, b) => b.reach - a.reach || priority(a.view) - priority(b.view)
	);
	// A provider that stopped at an earlier season is describing an earlier
	// entry: its status is that entry's ("Canceled", for Bake Off's BBC years)
	// and its last episode is that entry's finale. Only the views that reach
	// the latest season speak for the show, and when none of them has a status,
	// no badge is better than a stale one.
	const current = byReach.filter(({ reach }) => reach === (byReach[0]?.reach ?? 0));
	const status = current.find(({ view }) => view.status)?.view.status;

	const reach: MergedShowMetadata['reach'] = {};
	for (const { view, reach: r } of usable) reach[view.source] = r;
	for (const view of views) if (view && !(view.source in reach)) reach[view.source] = -1;

	return {
		season_count: Math.max(season_count, 1),
		season_episode_counts: counts,
		has_specials,
		status,
		next_episode_to_air: pickEpisode(
			current.flatMap(({ view }) => (view.next ? [view.next] : []))
		),
		last_episode_to_air: pickEpisode(
			current.flatMap(({ view }) => (view.last ? [view.last] : []))
		),
		reach,
	};
}
