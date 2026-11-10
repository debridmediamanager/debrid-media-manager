/**
 * One Pace (onepace.net), the fan re-edit of One Piece, placed as a show of its own: no TMDB,
 * IMDb or Plex record numbers it (TMDB and Plex have none, IMDb's tt31228002 lists a few arcs),
 * so DMM numbers it by One Pace's own list. Each main arc is a season in One Pace's order
 * (Romance Dawn 1 ... Egghead 33, as One Pace numbers its subtitle folders); its cover-story
 * arcs and specials are season 0, numbered in the list's order (One Pace's `00 Cover Stories
 * and Specials`). A file is matched by the manga chapters its name says it covers, which are
 * unique to an episode, in its arc; a file of an older cut, which One Pace has since re-edited
 * onto a chapter more or less or renumbered, is the episode it became (see `episodeOf`).
 */
import snapshot from '@/services/onePaceCatalogue.json';
import type { PlacedFile, PlacedRelease, PlaceRequest } from '@/services/placement';

const SITE = 'https://onepace.net';
/** The watch page, whose React Server Components flight (`RSC: 1`) carries the whole list. */
export const ONE_PACE_WATCH = `${SITE}/en/watch`;
/** The series key a source groups One Pace's files under, whichever release holds them. */
export const ONE_PACE_KEY = 'onepace';

export interface OnePaceEpisode {
	/** One Pace's own number in its arc. */
	number: number;
	/** The episode in DMM's season: `number` in a main arc, the running count in season 0. */
	episode: number;
	title: string;
	summary: string;
	/** The manga chapters it covers, `[from, to]`, in One Pace's order. */
	chapters: [number, number][];
	thumb?: string;
}

export interface OnePaceArc {
	slug: string;
	title: string;
	summary: string;
	season: number;
	poster?: string;
	episodes: OnePaceEpisode[];
}

export interface OnePaceCatalogue {
	summary: string;
	arcs: OnePaceArc[];
}

/** Fewer main arcs than this is a page DMM no longer reads right, never One Pace's list. */
const MIN_MAIN_ARCS = 30;

const absolute = (src: unknown) =>
	typeof src === 'string' && src.startsWith('/') && !src.startsWith('//')
		? SITE + src
		: undefined;
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/**
 * One Pace's list out of the watch page's flight: the row holding `timeline.segments`, whose
 * repeated values are references to that row (`$c:props:data:timeline:segments:3:chapters`).
 * Null when the page holds no list DMM can read.
 */
export function parseWatchFlight(flight: string): OnePaceCatalogue | null {
	const row = /^([0-9a-f]+):(.*"timeline":\{"segments".*)$/m.exec(flight);
	if (!row) return null;
	let element: any;
	try {
		element = JSON.parse(row[2]);
	} catch {
		return null;
	}
	const props = element?.[3];
	const value = (v: any): any => {
		if (typeof v !== 'string' || !v.startsWith('$')) return v;
		if (v.startsWith('$$')) return v.slice(1);
		const [id, ...path] = v.slice(1).split(':');
		// `$undefined`, and anything that is no reference into this row, says nothing
		if (id !== row[1] || path[0] !== 'props') return undefined;
		return path.slice(1).reduce((at, key) => at?.[key], props);
	};
	const terms = (chapters: any): any[] =>
		Array.isArray(value(chapters)?.terms) ? value(chapters).terms : [];
	const ranges = (chapters: any): [number, number][] =>
		terms(chapters).flatMap((term) =>
			Number.isInteger(term?.from) && Number.isInteger(term?.to) ? [[term.from, term.to]] : []
		);
	const segments = props?.data?.timeline?.segments;
	if (!Array.isArray(segments)) return null;
	let main = 0;
	let specials = 0;
	const arcs: OnePaceArc[] = [];
	for (const segment of segments) {
		const title = text(value(segment?.title));
		if (!title) continue;
		const cover = terms(segment.chapters).some((term) => term?.unit === 'cover_stories');
		const season = segment.special === true || cover ? 0 : ++main;
		const episodes: OnePaceEpisode[] = [];
		for (const part of Array.isArray(segment.parts) ? segment.parts : []) {
			const number = value(part?.part);
			// a main arc's half-numbered special (Loguetown 01.5, from the novel) covers no chapter
			if (!Number.isInteger(number) || (season > 0 && part.special === true)) continue;
			episodes.push({
				number,
				episode: season > 0 ? number : ++specials,
				title: text(value(part.title)),
				summary: text(value(part.description)),
				chapters: ranges(part.chapters),
				...(absolute(value(part.stills)?.[0]?.src)
					? { thumb: absolute(value(part.stills)[0].src) }
					: {}),
			});
		}
		const poster = absolute(value(segment.backdrops)?.[0]?.src);
		arcs.push({
			slug: text(value(segment.slug)),
			title,
			summary: text(value(segment.description)),
			season,
			...(poster ? { poster } : {}),
			episodes,
		});
	}
	if (main < MIN_MAIN_ARCS) return null;
	const description = /"name":"description","content":("(?:[^"\\]|\\.)*")/.exec(flight);
	let summary = '';
	try {
		summary = description ? text(JSON.parse(description[1])) : '';
	} catch {}
	return { summary, arcs };
}

/** One Pace's list is fetched again a day after the last fetch, and an hour after a failed one. */
const TTL_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30 * 1000;

let current = snapshot as OnePaceCatalogue;
let loadedAt = 0;
let lastFailureAt = 0;
let inFlight: Promise<void> | null = null;

/** Fetches One Pace's list now; a failure, or a page DMM cannot read, keeps the one it has. */
export async function refreshOnePace(fetcher: typeof fetch = fetch): Promise<void> {
	try {
		const res = await fetcher(ONE_PACE_WATCH, {
			headers: { RSC: '1' },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const parsed = parseWatchFlight(await res.text());
		if (!parsed) throw new Error('no list DMM can read');
		current = parsed;
		loadedAt = Date.now();
	} catch (error) {
		lastFailureAt = Date.now();
		console.error(
			"Could not load One Pace's list:",
			error instanceof Error ? error.message : 'unknown error'
		);
	}
}

/**
 * One Pace's list as DMM holds it, never waiting on onepace.net: the checked-in snapshot until a
 * fetch succeeds, which is started in the background once a day.
 */
export function onePaceCatalogue(fetcher: typeof fetch = fetch): OnePaceCatalogue {
	const now = Date.now();
	if (!inFlight && now - loadedAt >= TTL_MS && now - lastFailureAt >= RETRY_AFTER_FAILURE_MS) {
		inFlight = refreshOnePace(fetcher).finally(() => {
			inFlight = null;
		});
	}
	return current;
}

/** Test hook: back to the snapshot, never fetched. */
export function resetOnePaceForTests(): Promise<void> | null {
	const pending = inFlight;
	current = snapshot as OnePaceCatalogue;
	loadedAt = 0;
	lastFailureAt = 0;
	inFlight = null;
	return pending;
}

const TAG = /^\[One Pace\]/i;
const RANGES = String.raw`\d+(?:-\d+)?(?:\s*,\s*\d+(?:-\d+)?)*`;
/** `[One Pace][340-342] Water Seven 08 [1080p][6E2DB1B9].mkv`, `[One Pace][1079] Egghead 13 Extended`, `[One Pace][1-7] Romance Dawn [1080p]` */
const NAMED = new RegExp(
	String.raw`^\[One Pace\]\[(${RANGES})\]\s*([^[]*?)(?:\s+(\d{1,3}))?(?:\s+Extended)?\s*(?:\[|\.[a-z0-9]+$|$)`,
	'i'
);
/** Dressrosa's `[One Pace] Chapter 700-701 [720p][2A35B710].mkv`, which names no arc. */
const CHAPTERS = new RegExp(
	String.raw`^\[One Pace\]\s*Chapters?\s+(${RANGES})\s*(?:\[|\.[a-z0-9]+$|$)`,
	'i'
);

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** A release One Pace published: its name, or every file of it, carries One Pace's tag. */
export const isOnePace = (release: PlaceRequest) =>
	TAG.test(release.name) ||
	(release.files.length > 0 && release.files.every((file) => TAG.test(basename(file.path))));

const chapterKey = (ranges: [number, number][]) =>
	[...ranges]
		.sort((a, b) => a[0] - b[0] || a[1] - b[1])
		.map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`))
		.join(',');

const parseRanges = (written: string): [number, number][] =>
	written.split(',').map((range) => {
		const [from, to = from] = range.trim().split('-').map(Number);
		return [from, to];
	});

/** Arcs compared by their letters; One Pace spelled Alabasta `Arabasta` until it renamed it. */
const arcName = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '')
		.replace(/^arabasta$/, 'alabasta');

type Hit = { arc: OnePaceArc; episode: OnePaceEpisode };
const indexes = new WeakMap<OnePaceCatalogue, Map<string, Hit[]>>();

function chapterIndex(catalogue: OnePaceCatalogue): Map<string, Hit[]> {
	let index = indexes.get(catalogue);
	if (!index) {
		index = new Map();
		for (const arc of catalogue.arcs) {
			for (const episode of arc.episodes) {
				if (!episode.chapters.length) continue;
				const key = chapterKey(episode.chapters);
				index.set(key, [...(index.get(key) ?? []), { arc, episode }]);
			}
		}
		indexes.set(catalogue, index);
	}
	return index;
}

/** Every chapter a list of ranges covers. */
const chapterSet = (ranges: [number, number][]) =>
	new Set(
		ranges.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, n) => from + n))
	);

/** One set holds every member of the other. */
const nests = (a: Set<number>, b: Set<number>) => {
	const [small, large] = a.size <= b.size ? [a, b] : [b, a];
	return [...small].every((chapter) => large.has(chapter));
};

/**
 * The episode a file is: its chapters name it in its arc, under its number where it gives one.
 * A file of an older cut is the episode now on its chapters under another number (One Pace's
 * Baratie 05 [53-55] is its Baratie 04 now, since it made one of the old 03 and 04), else the one
 * under its own number whose chapters hold its own or are held by them (Drum Island 04 [139-140]
 * is 139-141 now), unless it holds another of today's episodes whole; a cut on other chapters
 * under another number (the old Baratie 04 [50-52], a part of today's 03) is none.
 */
function episodeOf(catalogue: OnePaceCatalogue, path: string, releaseArc?: string): Hit | null {
	const name = basename(path);
	const named = NAMED.exec(name);
	const chapters = named ? null : CHAPTERS.exec(name);
	const arc = named ? named[2].trim() : releaseArc;
	if (!(named || chapters) || !arc) return null;
	const number = named?.[3] ? Number(named[3]) : null;
	const ranges = parseRanges((named ?? chapters)![1]);
	const inArc = (hit: Hit) => arcName(hit.arc.title) === arcName(arc);
	const exact = (chapterIndex(catalogue).get(chapterKey(ranges)) ?? []).filter(inArc);
	const hits = exact.filter((hit) => number === null || number === hit.episode.number);
	if (hits.length === 1) return hits[0];
	if (exact.length === 1) return exact[0];
	if (number === null || exact.length) return null;
	const own = chapterSet(ranges);
	const arcHits = catalogue.arcs
		.flatMap((at) => at.episodes.map((episode) => ({ arc: at, episode })))
		.filter((hit) => inArc(hit) && hit.episode.chapters.length > 0);
	const nested = arcHits.filter(
		(hit) => hit.episode.number === number && nests(own, chapterSet(hit.episode.chapters))
	);
	// a cut holding a whole other episode of today's is two of them: Loguetown 03 [98-100] is 02 and 03
	const holds = (hit: Hit) => [...chapterSet(hit.episode.chapters)].every((c) => own.has(c));
	return nested.length === 1 && arcHits.filter(holds).every((hit) => hit === nested[0])
		? nested[0]
		: null;
}

/**
 * A One Pace release's answer: `kind`, the ids and every file's TMDB numbers null, as for a
 * release DMM cannot place, so a caller that does not read `series` keeps it unplaced; `series`
 * names the show and each season its files are on, and each file it numbers carries `series`.
 * A release none of whose files it numbers answers without `series`.
 */
export function placeOnePace(release: PlaceRequest, catalogue: OnePaceCatalogue): PlacedRelease {
	const releaseArc = NAMED.exec(release.name)?.[2].trim() || undefined;
	const seasons = new Map<number, OnePaceArc>();
	const files = release.files.map((file): PlacedFile => {
		const placed: PlacedFile = {
			path: file.path,
			season: null,
			episode: null,
			episodeEnd: null,
			how: null,
			tmdbEpisodeId: null,
		};
		const hit = episodeOf(catalogue, file.path, releaseArc);
		if (!hit) return placed;
		seasons.set(hit.arc.season, hit.arc);
		const { episode, title, summary, thumb } = hit.episode;
		return {
			...placed,
			series: {
				season: hit.arc.season,
				episode,
				title,
				summary,
				...(thumb ? { thumb } : {}),
			},
		};
	});
	const answer: PlacedRelease = { kind: null, imdbId: null, tmdbId: null, files };
	if (!seasons.size) return answer;
	const art = catalogue.arcs[0]?.poster;
	return {
		...answer,
		anime: true,
		series: {
			key: ONE_PACE_KEY,
			title: 'One Pace',
			summary: catalogue.summary,
			...(art ? { poster: art, art } : {}),
			seasons: [...seasons.values()]
				.sort((a, b) => a.season - b.season)
				.map((arc) => ({
					season: arc.season,
					title: arc.title,
					summary: arc.summary,
					...(arc.poster ? { poster: arc.poster } : {}),
				})),
		},
	};
}
