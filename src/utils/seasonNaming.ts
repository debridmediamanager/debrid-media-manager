/**
 * What a release title *itself* says about seasons and episodes.
 *
 * `ptt` is the parser everything else here leans on, and for an automated add
 * it is not enough on its own. Measured over 4,498 real titles pulled from the
 * live index on 2026-09-12 (18 shows, three seasons each), it invents an
 * episode number out of parts of the name that have nothing to do with
 * episodes:
 *
 *   The.Wire.S02.720p.WEB-DL.2xRus.Eng.HDCLUB        -> episode 2   (from `2xRus`)
 *   Breaking.Bad.S01.2160p.WEB-DL.5xRus.Ukr.Eng...   -> episode 5   (from `5xRus`)
 *   Breaking.Bad.S01.1080p.3D.FULL-SBS.HEVC...       -> episode 3   (from `3D`)
 *   The Wire - Temporada 1 Completa [Cap. 101_113]   -> episode 101 (from `Cap. 101`)
 *
 * 131 of the 310 rows it called single episodes - 42% - were whole season
 * packs. Left unchecked that is wrong in both directions at once: the pack is
 * dropped from the pack list because it "has an episode", and it is offered as
 * one episode, so a run adds a whole season believing it got episode two and
 * then adds eleven more releases for the episodes it thinks are still missing.
 *
 * So these functions read the notations release groups actually write, and an
 * automated add requires them to agree with `ptt` before it spends a slot. Over
 * that same corpus the season reader confirmed all but three of the 3,630 packs
 * `ptt` accepted, and contradicted none of them - the residue is malformed
 * (`Black.Mirror.S011080p`) or mojibake (`3Âª Temporada`), and refusing those is
 * the right answer for an unattended add.
 */

/**
 * Separators release names put between tokens. `_` is in here because
 * `The Wire_S02` is a real shape and a plain word boundary does not see the
 * gap between `e` and `_`; brackets are here for `All Seasons (1-8)`.
 */
const SEP = '[ ._\\-_()\\[\\]]*';

/**
 * Words that introduce a season number. English plus the ones real release
 * groups ship - measured in the corpus: `Temporada` (Spanish/Portuguese),
 * `saison` (French), `Sezon`/`sezona` (Slavic), `Сезон` (Russian), and
 * `Staffel`/`stagione` for good measure.
 */
const SEASON_WORDS =
	'seasons?|temporadas?|saisons?|stagioni|stagione|staffel|sezona?|sezon|сезон[а-я]*';

const S_TOKEN = new RegExp(`(?:^|[^A-Za-z0-9])s(\\d{1,2})(?![0-9])`, 'gi');
const S_RANGE = new RegExp(
	`(?:^|[^A-Za-z0-9])s(\\d{1,2})${SEP}(?:-|–|—|~|to|thru|through)${SEP}s?(\\d{1,2})(?![0-9])`,
	'gi'
);
const SEASON_WORD = new RegExp(SEASON_WORDS, 'gi');
/** `3ª Temporada`, `2nd Season` - the number leads the word instead of following it. */
const LEADING_NUMBER = new RegExp(`(\\d{1,2})(?:st|nd|rd|th|ª|°)?${SEP}(?:${SEASON_WORDS})`, 'gi');

const NUMBER_RUN = new RegExp(`^${SEP}(\\d{1,2})(?:st|nd|rd|th|ª|°)?(?![0-9])`, 'i');
/**
 * What may join two numbers in a list. A bare space or dot counts, because
 * `Seasons 1.2.3.4.5` and `Season 1 2 3 4 5 6 7 8 9 10` are both real - and a
 * resolution cannot be mistaken for a season here, since `1080p` fails the
 * two-digit-then-non-digit test above.
 */
const NUMBER_LINK = new RegExp(
	`^(?:${SEP}(?:,|&|\\+|and|y|e|·|-|–|—|~|to|thru|through)${SEP}|[ .]+)`,
	'i'
);
const RANGE_LINK = new RegExp(`^${SEP}(?:-|–|—|~|to|thru|through)${SEP}$`, 'i');

/** A cap on how many seasons a single range may span, so junk cannot claim forty. */
const MAX_RANGE = 40;

const addRange = (into: Set<number>, from: number, to: number) => {
	if (from < 1 || to < from || to - from > MAX_RANGE) return;
	for (let n = from; n <= to; n++) into.add(n);
};

/**
 * Every season the title names, by any notation. An empty set means the title
 * says nothing about seasons - not that it names none.
 */
export function namedSeasons(title: string): Set<number> {
	const found = new Set<number>();
	if (!title) return found;

	// Ranges first (`S01-S05`, `S1~3`); the single-token pass below then adds
	// the endpoints again harmlessly.
	for (const match of title.matchAll(S_RANGE)) {
		addRange(found, Number(match[1]), Number(match[2]));
	}
	for (const match of title.matchAll(S_TOKEN)) {
		found.add(Number(match[1]));
	}
	for (const match of title.matchAll(LEADING_NUMBER)) {
		found.add(Number(match[1]));
	}

	// The word form, followed by a run of numbers that may be a list, a range,
	// or a single value: `Season 3`, `Seasons 1-5`, `Season 1, 2, 3, 4 & 5`.
	for (const match of title.matchAll(SEASON_WORD)) {
		let rest = title.slice(match.index! + match[0].length);
		let previous: number | null = null;
		let joinWasRange = false;

		for (;;) {
			const number = NUMBER_RUN.exec(rest);
			if (!number) break;
			const value = Number(number[1]);
			if (joinWasRange && previous !== null) addRange(found, previous, value);
			else found.add(value);
			previous = value;
			rest = rest.slice(number[0].length);

			const link = NUMBER_LINK.exec(rest);
			if (!link) break;
			joinWasRange = RANGE_LINK.test(link[0]);
			rest = rest.slice(link[0].length);
		}
	}

	return found;
}

/**
 * `S03E04` and friends, which is the only notation that proves a season *and*
 * an episode at once. `3x04` counts too; `2xRus` and `x265` do not, because the
 * digits have to sit on the left of the `x` and more digits on the right.
 */
const SXXEYY = new RegExp(`(?:^|[^A-Za-z0-9])s(\\d{1,2})${SEP}e(\\d{1,3})(?![0-9])`, 'gi');
const NXM = new RegExp(`(?:^|[^A-Za-z0-9])(\\d{1,2})x(\\d{1,3})(?![0-9])`, 'gi');
/** A further episode hanging off one `SxxEyy`: `E05`, `-E06`. */
const EPISODE_RUN = new RegExp(`^(${SEP})e?(\\d{1,3})(?![0-9])`, 'i');
const EPISODE_RANGE_LINK = new RegExp(`^${SEP}(?:-|–|—|~|to)${SEP}e?$`, 'i');
/** A two-parter spans a couple of episodes; anything wider is a mis-read. */
const MAX_EPISODE_RANGE = 60;

const pairKey = (season: number, episode: number) => `${season}:${episode}`;

/**
 * Every `season`/`episode` pair the title names, as `"<season>:<episode>"`
 * keys. An empty set means the title names no episode at all, which is what a
 * season pack looks like.
 */
export function namedEpisodes(title: string): Set<string> {
	const found = new Set<string>();
	if (!title) return found;

	for (const match of title.matchAll(NXM)) {
		found.add(pairKey(Number(match[1]), Number(match[2])));
	}

	for (const match of title.matchAll(SXXEYY)) {
		const season = Number(match[1]);
		let previous = Number(match[2]);
		found.add(pairKey(season, previous));

		let rest = title.slice(match.index! + match[0].length);
		for (;;) {
			const run = EPISODE_RUN.exec(rest);
			if (!run) break;
			const join = run[1];
			const isRange = EPISODE_RANGE_LINK.test(`${join}e`) || EPISODE_RANGE_LINK.test(join);
			// Continue a run only across an episode marker or a dash. A bare
			// separator would read `S01E01 1080p` as episode 1080.
			if (!isRange && !/e/i.test(run[0].slice(join.length))) break;
			const value = Number(run[2]);
			if (isRange && previous <= value && value - previous <= MAX_EPISODE_RANGE) {
				for (let episode = previous; episode <= value; episode++) {
					found.add(pairKey(season, episode));
				}
			} else {
				found.add(pairKey(season, value));
			}
			previous = value;
			rest = rest.slice(run[0].length);
		}
	}

	return found;
}

/** Whether the title itself names this season. */
export function titleNamesSeason(title: string, season: number): boolean {
	return namedSeasons(title).has(season);
}

/** The episodes of one season that the title names, in ascending order. */
export function episodesNamedForSeason(title: string, season: number): number[] {
	const prefix = `${season}:`;
	const episodes: number[] = [];
	for (const key of namedEpisodes(title)) {
		if (!key.startsWith(prefix)) continue;
		episodes.push(Number(key.slice(prefix.length)));
	}
	return episodes.sort((a, b) => a - b);
}

/** Whether the title names no episode whatsoever, which is what a pack looks like. */
export function titleNamesNoEpisode(title: string): boolean {
	return namedEpisodes(title).size === 0;
}
