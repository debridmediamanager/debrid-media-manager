import type { UserTorrent } from '@/torrent/userTorrent';
import { normalize } from '@/utils/mediaId';
import type { ParsedShow } from '@ctrl/video-filename-parser';

/**
 * What "I already have this season" means, and what to add when I don't.
 *
 * The season page has always answered the first question by infohash: a row is
 * in your library when `hashAndProgress` holds `rd:<that hash>`. That is the
 * right test for one row on screen and the wrong one for a show-wide action —
 * it can only recognise the exact release it is looking at. Three cases break
 * it, and all three are ordinary:
 *
 *  - the season was added last month from a different release than today's
 *    top candidate, so the pack is re-added as a duplicate;
 *  - the library holds one `S01-S05` pack, which names no single season and so
 *    leaves every one of those five looking empty;
 *  - the library holds two episodes of a ten-episode season, which is not the
 *    season but is not nothing either.
 *
 * So coverage is decided from the library itself. Each torrent's `info` is a
 * `ParsedShow` parsed from its *name* (`fetchTorrents.ts`), which is all that
 * is available: RD library rows carry `selectedFiles: []`, so there is no
 * per-file episode list to count for the one service that matters most here.
 * A name is enough for the question actually being asked — `Show.S03` claims a
 * season, `Show.S03E04` claims an episode, `Show.S01-S05` claims five seasons.
 */

/** A season's state once the library and the cached candidates are both known. */
export type SeasonPlanStatus =
	/** Already covered by a pack (or a multi-season pack) in the library. */
	| 'held'
	/** A cached pack will be added, whether or not loose episodes are held. */
	| 'pack'
	/** No cached pack, so the missing episodes are added one at a time. */
	| 'episodes'
	/** Nothing cached covers what is missing. */
	| 'gap';

export type SeasonCoverage = {
	/** A library release names this whole season, so the season is covered. */
	hasPack: boolean;
	/** Episode numbers held individually, ascending. Empty when `hasPack`. */
	episodes: number[];
};

export type SeasonCandidate = {
	hash: string;
	title: string;
	sizeMb: number;
	/** Video files the provider reported; absent until an availability check has run. */
	videoCount?: number;
	/** Seasons the title claims. A complete-series release claims several. */
	seasons?: number[];
};

export type SeasonPlanEntry = {
	season: number;
	status: SeasonPlanStatus;
	/** Episodes expected to exist, already capped to what has aired. */
	expectedEpisodeCount: number;
	coverage: SeasonCoverage;
	/** Episodes still to acquire. Empty for `held`, and for `pack` it is only a report. */
	missingEpisodes: number[];
	/** Ranked packs to try, best first. Only set for `pack`. */
	packCandidates: SeasonCandidate[];
	/** Ranked candidates per missing episode number. Only set for `episodes`. */
	episodeCandidates: Map<number, SeasonCandidate[]>;
	/** How many provider adds this entry will attempt at most. */
	addCount: number;
};

/**
 * The window the season page has always used for "this release is the season":
 * within two of the expected episode count, so a pack that bundles a recap or
 * drops a clip show still counts. Extracted from the page so the All Seasons
 * run and the Whole Season button cannot drift apart on what complete means.
 */
export function isCompleteSeasonPack(videoCount: number, expectedEpisodeCount: number): boolean {
	const min = Math.max(1, expectedEpisodeCount - 2);
	const max = expectedEpisodeCount + 2;
	return videoCount >= min && videoCount <= max;
}

/**
 * How many episodes a release ought to carry, given the seasons it claims.
 *
 * A complete-series pack has to be judged against the whole run, not against
 * one season. Measured on the live index 2026-09-12: `tt0306414` seasons one
 * and five had *no* cached single-season pack at all, only `S01-S05` releases
 * carrying 60 videos - which is exactly 13+12+12+13+10, and which a
 * one-season window rejects out of hand. Judged that way both seasons fell
 * through to twenty-three individual episode adds while a single cached
 * release covering the entire show sat there unused.
 *
 * Seasons the show metadata says nothing about are left out of the sum rather
 * than counted as zero, so a pack claiming a season DMM has no count for is
 * judged on the ones it does know.
 */
export function expectedEpisodesForClaim(
	claimedSeasons: number[] | undefined,
	season: number,
	episodeCounts: Record<number, number>
): number {
	const claimed = claimedSeasons?.length ? claimedSeasons : [season];
	const known = claimed.filter((s) => (episodeCounts[s] ?? 0) > 0);
	if (known.length === 0) return episodeCounts[season] ?? 0;
	return known.reduce((total, s) => total + episodeCounts[s], 0);
}

/**
 * Episodes of a season that have actually aired.
 *
 * `season_episode_counts` comes from cinemeta and counts the whole ordered
 * season, unaired episodes included. Judged against that, the season currently
 * airing is permanently incomplete: no pack can satisfy the window above, so
 * every run would retry it and every run would report it as a gap. The show's
 * `last_episode_to_air` is the real boundary, and it is already on the page.
 */
export function airedEpisodeCount(
	season: number,
	expectedEpisodeCount: number,
	lastEpisodeToAir?: { season_number: number; episode_number: number } | null
): number {
	if (!lastEpisodeToAir) return expectedEpisodeCount;
	if (lastEpisodeToAir.season_number !== season) return expectedEpisodeCount;
	if (!Number.isFinite(lastEpisodeToAir.episode_number)) return expectedEpisodeCount;
	return Math.max(0, Math.min(expectedEpisodeCount, lastEpisodeToAir.episode_number));
}

const asParsedShow = (torrent: UserTorrent): ParsedShow | null => {
	const info = torrent.info as ParsedShow | undefined;
	if (!info || typeof info !== 'object') return null;
	return info;
};

const seasonsOf = (info: ParsedShow): number[] =>
	Array.isArray(info.seasons) ? info.seasons.filter((s) => Number.isInteger(s)) : [];

const episodesOf = (info: ParsedShow): number[] =>
	Array.isArray(info.episodeNumbers)
		? info.episodeNumbers.filter((e) => Number.isInteger(e))
		: [];

/**
 * Whether a parsed name claims whole seasons rather than episodes.
 *
 * `fullSeason` alone is not the test. Measured against the parser on
 * 2026-09-12: `The.Wire.S03.EXTRAS.1080p` and `The.Wire.S03.SUBPACK` both come
 * back `fullSeason: true`, flagged only by `isSeasonExtra` - an extras disc
 * would otherwise convince the run that the season is held and skip it
 * forever. `The.Wire.S03.Part.1.1080p` is `fullSeason: false` with
 * `isPartialSeason: true`, which is a half-season and equally not the season.
 */
const claimsWholeSeason = (info: ParsedShow): boolean => {
	if (info.isSeasonExtra || info.isPartialSeason) return false;
	if (typeof info.fullSeason === 'boolean') return info.fullSeason;
	// Older parses carry no flag; a season with no episode numbers is a pack.
	return episodesOf(info).length === 0;
};

/**
 * What the library already holds for one season of one show.
 *
 * Two ways in, and both are needed. `knownHashes` is every hash DMM files under
 * this season of this imdb id, so an intersection with it is anchored to the
 * title and cannot be confused by another show with a similar name — that is
 * the precise test and it is preferred. It can only recognise releases DMM has
 * scraped under that exact season key, though, which a `S01-S05` pack never is,
 * so the parsed name is the fallback.
 *
 * The fallback matches on the normalised title, which under-matches rather than
 * over-matches ("The Office" will not claim "The Office (US)"). That direction
 * is deliberate: under-matching adds a duplicate, which is visible and
 * recoverable, while over-matching silently skips a season the user asked for.
 */
export function getSeasonCoverage(
	libraryItems: UserTorrent[],
	{
		season,
		showTitle,
		servicePrefix,
		knownHashes,
	}: {
		season: number;
		showTitle: string;
		servicePrefix: 'rd' | 'tb';
		knownHashes?: Set<string>;
	}
): SeasonCoverage {
	const wantedTitle = normalize(showTitle);
	const episodes = new Set<number>();
	let hasPack = false;

	for (const torrent of libraryItems) {
		if (!torrent.id?.startsWith(`${servicePrefix}:`)) continue;

		const info = asParsedShow(torrent);
		if (!info) continue;
		const seasons = seasonsOf(info);

		// By hash: the release is filed under this season of this imdb id, which
		// is anchored to the title and cannot be confused by a similarly named
		// show - and it still counts when the name itself parses no season.
		// By name: the fallback for releases DMM has not scraped under this
		// season key, a multi-season pack chief among them.
		const byHash = knownHashes?.has(torrent.hash?.toLowerCase() ?? '') ?? false;
		const byName =
			seasons.includes(season) && !!info.title && normalize(info.title) === wantedTitle;
		if (!byHash && !byName) continue;

		if (claimsWholeSeason(info)) {
			hasPack = true;
			continue;
		}
		for (const episode of episodesOf(info)) episodes.add(episode);
	}

	if (hasPack) return { hasPack: true, episodes: [] };
	return { hasPack: false, episodes: [...episodes].sort((a, b) => a - b) };
}

/**
 * Which episodes of a season are still wanted, given what is held.
 *
 * A season whose expected count is unknown or zero (an announced season with
 * nothing aired) asks for nothing rather than guessing at episode one.
 */
export function missingEpisodesFor(
	coverage: SeasonCoverage,
	expectedEpisodeCount: number
): number[] {
	if (coverage.hasPack) return [];
	if (!Number.isFinite(expectedEpisodeCount) || expectedEpisodeCount <= 0) return [];
	const held = new Set(coverage.episodes);
	const missing: number[] = [];
	for (let episode = 1; episode <= expectedEpisodeCount; episode++) {
		if (!held.has(episode)) missing.push(episode);
	}
	return missing;
}

/**
 * The per-season decision, in the order the user asked for it: a cached pack
 * beats loose episodes even when some episodes are already held, because it is
 * one add rather than ten and the window above already treats a pack that is
 * one episode short as the season. Only when no pack is cached does the run
 * fall back to filling the gaps episode by episode.
 */
export function planSeason({
	season,
	expectedEpisodeCount,
	episodeCounts,
	coverage,
	packCandidates,
	episodeCandidates,
}: {
	season: number;
	expectedEpisodeCount: number;
	/** Per-season episode counts, so a multi-season pack is judged on its whole claim. */
	episodeCounts?: Record<number, number>;
	coverage: SeasonCoverage;
	packCandidates: SeasonCandidate[];
	episodeCandidates: Map<number, SeasonCandidate[]>;
}): SeasonPlanEntry {
	const missingEpisodes = missingEpisodesFor(coverage, expectedEpisodeCount);
	const base = {
		season,
		expectedEpisodeCount,
		coverage,
		missingEpisodes,
	};

	if (coverage.hasPack) {
		return {
			...base,
			status: 'held',
			packCandidates: [],
			episodeCandidates: new Map(),
			addCount: 0,
		};
	}

	if (missingEpisodes.length === 0) {
		// Every episode is held individually - the season is complete without a
		// pack, so adding one would only duplicate it.
		return {
			...base,
			status: 'held',
			packCandidates: [],
			episodeCandidates: new Map(),
			addCount: 0,
		};
	}

	const counts = episodeCounts ?? { [season]: expectedEpisodeCount };
	const packs = packCandidates.filter((candidate) => {
		if (candidate.videoCount === undefined) return false;
		return isCompleteSeasonPack(
			candidate.videoCount,
			expectedEpisodesForClaim(candidate.seasons, season, counts)
		);
	});
	if (packs.length > 0) {
		return {
			...base,
			status: 'pack',
			packCandidates: packs,
			episodeCandidates: new Map(),
			addCount: 1,
		};
	}

	const wanted = new Map<number, SeasonCandidate[]>();
	for (const episode of missingEpisodes) {
		const found = episodeCandidates.get(episode);
		if (found && found.length > 0) wanted.set(episode, found);
	}
	if (wanted.size === 0) {
		return {
			...base,
			status: 'gap',
			packCandidates: [],
			episodeCandidates: new Map(),
			addCount: 0,
		};
	}

	return {
		...base,
		status: 'episodes',
		packCandidates: [],
		episodeCandidates: wanted,
		addCount: wanted.size,
	};
}

/**
 * Totals the confirmation dialog needs, so it can state cost before anything is
 * added.
 *
 * Pack adds are counted by distinct first choice, not per season: one
 * complete-series release is the first choice for every season it covers, and
 * the run adds it once. Counting per season would promise five torrents and
 * add one.
 */
export function summarisePlan(entries: SeasonPlanEntry[]) {
	const held = entries.filter((e) => e.status === 'held');
	const packs = entries.filter((e) => e.status === 'pack');
	const episodes = entries.filter((e) => e.status === 'episodes');
	const gaps = entries.filter((e) => e.status === 'gap');
	const distinctPackHashes = new Set(
		packs.map((entry) => entry.packCandidates[0]?.hash).filter(Boolean)
	);
	const episodeAddCount = episodes.reduce((total, entry) => total + entry.addCount, 0);
	return {
		held,
		packs,
		episodes,
		gaps,
		episodeAddCount,
		totalAddCount: distinctPackHashes.size + episodeAddCount,
	};
}
