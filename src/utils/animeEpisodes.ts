/**
 * Episode numbers read out of anime release names.
 *
 * One AniDB entry is one season, cour, OVA or film, and fansub groups number an
 * entry's episodes from 1 without naming a season: `[SubsPlease] Sousou no
 * Frieren - 05 (1080p)`. The TV parser (`S01E05`) finds nothing in that, so the
 * anime page reads names itself. Every shape handled here was taken from the
 * `anime:anidb-*` rows in production; `src/test/fixtures/anime/README.md` lists
 * the corpus the tests replay.
 *
 * The number is the entry's own. A group that keeps counting across seasons
 * (`Frieren - 29` for the second season's first episode) is filed under 29,
 * because nothing in the name says otherwise.
 */

export type AnimeEpisodeMatch =
	| { kind: 'episode'; episode: number }
	/** A pack: a range of episodes, or a whole season named without one. */
	| { kind: 'batch'; from?: number; to?: number };

/** No real entry runs past this; One Piece was at 1100 in 2026. */
const MAX_EPISODE = 4000;

const isYear = (value: number) => value >= 1900 && value <= 2099;

function toEpisode(raw: string | undefined): number | null {
	if (raw === undefined) return null;
	const value = parseInt(raw, 10);
	if (!Number.isInteger(value) || value < 0 || value > MAX_EPISODE) return null;
	return value;
}

function toRange(fromRaw: string, toRaw: string): AnimeEpisodeMatch | null {
	const from = toEpisode(fromRaw);
	const to = toEpisode(toRaw);
	if (from === null || to === null || to <= from) return null;
	// `2019-2024` is a year span, not episodes two thousand apart.
	if (isYear(from) && isYear(to)) return null;
	return { kind: 'batch', from, to };
}

/**
 * Everything in a name that looks like a number and is not an episode:
 * resolutions, codecs, bit depths, audio channels and CRC32 tags. Removing
 * them first is what lets the bare-number shapes below stay strict.
 */
function stripNoise(name: string): string {
	return (
		name
			// A trailing extension, so `05.mkv` ends at the number.
			.replace(/\.(?:mkv|mp4|avi|m4v|ts|webm)$/i, '')
			.replace(/_/g, ' ')
			// CRC32 tags: `[5FFF934E]`, `(A3E27C18)`.
			.replace(/[[(][0-9A-F]{8}[\])]/gi, ' ')
			// Resolutions and frame sizes: `1080p`, `2160P`, `1920x1080`, `4K`.
			.replace(/\b\d{3,4}[pi]\b/gi, ' ')
			.replace(/[[(](?:360|480|540|576|720|1080|1440|2160)[\])]/g, ' ')
			.replace(/\b\d{3,4}x\d{3,4}\b/gi, ' ')
			.replace(/\b[48]k\b/gi, ' ')
			// Codecs, depths and audio: `x265`, `H.264`, `10bit`, `AAC2.0`, `DDP5.1`.
			.replace(/\b(?:x|h\.?)26[45]\b/gi, ' ')
			.replace(/\b(?:hi)?1?[0-9]-?bits?\b/gi, ' ')
			.replace(/\b(?:aac|ac3|eac3|ddp?|dts|flac|opus|truehd)\s?\d\.\d\b/gi, ' ')
			.replace(/\b[257]\.[01]\b/g, ' ')
	);
}

/** Names that say they are a pack without saying which episodes it holds. */
const PACK_WORDS =
	/\b(?:batch|complete(?: series| season)?|season\s?\d{1,2}|s\d{1,2}(?=[\s.\])]|$)|vol(?:ume)?\.?\s?\d{1,2})|全集|全\d+[話话集]/i;

/** Words a trailing number counts, when it is not an episode. */
const NOT_AN_EPISODE_BEFORE = /(?:vol(?:ume)?|part|movie|film|season|cour|no|s)\.?\s?$/i;

/**
 * Reads the episode, or the pack, a release name carries. Returns null when
 * the name carries neither, which is common for films and BD remuxes.
 */
export function parseAnimeEpisode(rawName: string): AnimeEpisodeMatch | null {
	if (!rawName) return null;
	const name = stripNoise(rawName);

	// `S01E01-E12`, `S01E01-12`, `E01-E12`: a range with the episode marker.
	const markedRange = /\b(?:s\d{1,2}\s?)?e(\d{1,4})\s?(?:-|~)\s?e?(\d{1,4})\b/i.exec(name);
	if (markedRange) {
		const range = toRange(markedRange[1], markedRange[2]);
		if (range) return range;
	}

	// `S04E23`, `S01E05v2`. The season is dropped: an AniDB entry is one season,
	// and groups disagree about what to call it (`S04E23` and `S01E23` are the
	// same episode of Bookworm's fourth season in production).
	const tv = /\bs\d{1,2}\s?e(\d{1,4})(?:v\d{1,2})?(?![\d-])/i.exec(name);
	if (tv) {
		const episode = toEpisode(tv[1]);
		if (episode !== null) return { kind: 'episode', episode };
	}

	// `- 01 ~ 28`, `(01-28)`, `[1-8 из 24]`, `01-12 Batch`, `ep1-15`. A hyphen
	// with spaces round it is not a range: `Mushoku Tensei II ... Part 2 - 08`
	// is episode 8 of a title that ends in a 2.
	const bareRange =
		/(?:^|[\s[(【])(?:ep?\.?\s?)?(\d{1,4})(?:-|\s?~\s?|\sto\s)(?:ep?\.?\s?)?(\d{1,4})(?=[\s\])】]|$)/i.exec(
			name
		);
	if (bareRange) {
		const range = toRange(bareRange[1], bareRange[2]);
		if (range) return range;
	}

	// `Episode 5`, `Ep05`, `EP.05`, `E05`.
	const worded = /\b(?:episode|ep|e)\.?\s?(\d{1,4})(?:v\d{1,2})?\b/i.exec(name);
	if (worded) {
		const episode = toEpisode(worded[1]);
		if (episode !== null && !isYear(episode)) return { kind: 'episode', episode };
	}

	// `第05話`, `第12集`, `05話`. `全8話` is "all eight episodes", a pack.
	const cjk = /(?<!全\s?)第?\s?(\d{1,4})\s?[話话集]/.exec(name);
	if (cjk) {
		const episode = toEpisode(cjk[1]);
		if (episode !== null) return { kind: 'episode', episode };
	}

	// The fansub form: `Title - 05`, `Title - 17v2 [480p]`. The last one wins,
	// since a title can itself contain ` - ` (`Honzuki ... - Ryushu no Youjo - 23`).
	// A decimal is a recap (`26.5`, `14.5 OVA`), which no whole episode is.
	const dashed = [...name.matchAll(/\s-\s(\d{1,4})(?:v\d{1,2})?(?=\s|$|[[(]|\.(?!\d))/g)];
	if (dashed.length > 0) {
		const episode = toEpisode(dashed[dashed.length - 1][1]);
		if (episode !== null && !isYear(episode)) return { kind: 'episode', episode };
	}

	// `[Nekomoe kissaten][Sousou no Frieren][05][1080p]`. A bracket opening
	// the name is the release group, even when the group is a number (`[224]`).
	const bracketed = /(?<!^)[[【]\s?(\d{1,4})(?:v\d{1,2})?\s?[\]】]/.exec(name);
	if (bracketed) {
		const episode = toEpisode(bracketed[1]);
		if (episode !== null && !isYear(episode)) return { kind: 'episode', episode };
	}

	if (PACK_WORDS.test(name)) return { kind: 'batch' };

	// A bare number just before the tags or at the very end: `MM! 06 [6029C984]`,
	// `Fate Apocrypha 13 (720p)`, `Tatoeba.Last.Dungeon.08.mkv`. Checked after
	// the pack words so `Vol.3 [BD]` stays a pack, and never read after a word
	// that makes it something else (`Movie 14`, `Part 2`, `Vol 6`).
	// A dot after a digit is a decimal (`26.5.2`), not a separator.
	const trailing = /(?:^|\s|(?<!\d)\.)(\d{1,4})(?:v\d{1,2})?(?=\s*(?:[[(]|$))/.exec(
		name.trimEnd()
	);
	if (trailing && !NOT_AN_EPISODE_BEFORE.test(name.slice(0, trailing.index + 1))) {
		const episode = toEpisode(trailing[1]);
		if (episode !== null && !isYear(episode)) return { kind: 'episode', episode };
	}
	return null;
}

export interface AnimeEpisodeSummary {
	/** Releases naming each episode, ascending by episode. */
	episodes: { episode: number; count: number }[];
	/** Releases that are packs, with or without a range. */
	batches: number;
	/** Releases that name neither. */
	unnumbered: number;
}

export function summarizeAnimeEpisodes(names: readonly string[]): AnimeEpisodeSummary {
	const counts = new Map<number, number>();
	let batches = 0;
	let unnumbered = 0;
	for (const name of names) {
		const match = parseAnimeEpisode(name);
		if (!match) unnumbered++;
		else if (match.kind === 'batch') batches++;
		else counts.set(match.episode, (counts.get(match.episode) ?? 0) + 1);
	}
	return {
		episodes: [...counts.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([episode, count]) => ({ episode, count })),
		batches,
		unnumbered,
	};
}

/**
 * The episode filter the anime page offers: one episode, the packs, or the
 * names that carry neither.
 */
export type AnimeEpisodeFilter = number | 'batch' | 'unnumbered';

export function matchesAnimeEpisodeFilter(name: string, filter: AnimeEpisodeFilter): boolean {
	const match = parseAnimeEpisode(name);
	if (filter === 'unnumbered') return match === null;
	if (filter === 'batch') return match?.kind === 'batch';
	return match?.kind === 'episode' && match.episode === filter;
}

/** Parses the `episode` query parameter the torrents route and page share. */
export function parseAnimeEpisodeFilter(raw: unknown): AnimeEpisodeFilter | null {
	if (typeof raw !== 'string' || raw === '') return null;
	if (raw === 'batch' || raw === 'unnumbered') return raw;
	if (!/^\d{1,4}$/.test(raw)) return null;
	return toEpisode(raw);
}
