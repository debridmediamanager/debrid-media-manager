// Usenet results for a media page, and the hand-off to nzb2rd.
//
// Two external services sit behind this file, and neither may be reached from
// the browser:
//
//   * The Newznab indexer (DrunkenSlug). Its API key is a secret, and — the
//     part that is easy to miss — every `link`/`enclosure` URL in a search
//     response has the key embedded in its `&r=` parameter. Shipping a raw item
//     to the client leaks the key, so `searchUsenet` returns a whitelist of
//     fields and the caller downloads NZBs by opaque id through `fetchNzb`.
//   * nzb2rd itself, which speaks plain HTTP with no CORS and no auth. Its
//     public vhost forwards only /webseed/*, so the management API answers on
//     the Tailscale address alone — same arrangement as the debrid uploader.

import { isVideo } from '@/utils/selectable';
import { addHashAsMagnet, getTorrentInfo, selectFiles } from './realDebrid';

const DEFAULT_NZB2RD_URL = 'http://100.90.231.66:3200'; // dmm over Tailscale
const DEFAULT_NEWZNAB_URL = 'https://drunkenslug.com/api';

export function getNzb2rdUrl(): string {
	return (process.env.NZB2RD_URL || DEFAULT_NZB2RD_URL).replace(/\/+$/, '');
}

export function getNewznabUrl(): string {
	return (process.env.NEWZNAB_URL || DEFAULT_NEWZNAB_URL).replace(/\/+$/, '');
}

export function getNewznabApiKey(): string {
	return process.env.NEWZNAB_API_KEY || '';
}

/** The only fields that reach the browser. Deliberately excludes `link`. */
export interface UsenetResult {
	/** Opaque indexer id, the handle for a later `t=get`. */
	id: string;
	title: string;
	/** Bytes. 0 when the indexer reported no size. */
	size: number;
	/** A whole-season release rather than a single episode. Shows only. */
	isPack?: boolean;
}

// Episode markers as they actually appear on the indexer: S02E09, S02 E09,
// S02.EP09, 2x09, "Episode 9". The EP and spaced forms matter — without them
// "Game of Thrones S02 EP09.mkv" reads as a season pack.
const EPISODE_RE = /(S\d{1,2}\s*[._-]?\s*E(?:P)?\s*\d{1,3})|(\b\d{1,2}x\d{2}\b)|(\bEpisode\s*\d+)/i;

export function looksLikeEpisode(title: string): boolean {
	return EPISODE_RE.test(title);
}

/** Names the season without naming an episode in it. */
export function isSeasonPack(title: string, seasonNum: number): boolean {
	if (looksLikeEpisode(title)) return false;
	const season = new RegExp(`(S0?${seasonNum}\\b)|(Season[\\s._-]*0?${seasonNum}\\b)`, 'i');
	return season.test(title);
}

const IMDB_RE = /^tt\d{7,9}$/;

export function isValidImdbId(value: unknown): value is string {
	return typeof value === 'string' && IMDB_RE.test(value);
}

type NewznabAttr = { _name?: string; _value?: string };

function asArray<T>(value: T | T[] | undefined | null): T[] {
	if (Array.isArray(value)) return value;
	return value ? [value] : [];
}

function attrValue(attrs: NewznabAttr[], name: string): string | undefined {
	return attrs.find((a) => a._name === name)?._value;
}

/**
 * The guid arrives as a details URL (`https://…/details/<id>`); `t=get` wants
 * only the last segment. Some indexers already send the bare id, so the split
 * has to be tolerant of both.
 */
function guidToId(guid: unknown): string {
	const raw = typeof guid === 'string' ? guid : ((guid as { text?: string } | null)?.text ?? '');
	return raw.split('/').filter(Boolean).pop() ?? '';
}

/**
 * Normalise one Newznab `item`. Size prefers the `size` attribute and falls
 * back to the enclosure length, because indexers are inconsistent about which
 * of the two they populate.
 */
export function parseNewznabItem(item: unknown): UsenetResult | null {
	const entry = item as {
		title?: unknown;
		guid?: unknown;
		'newznab:attr'?: NewznabAttr | NewznabAttr[];
		enclosure?: { _length?: string };
	} | null;
	if (!entry) return null;

	const title = typeof entry.title === 'string' ? entry.title.trim() : '';
	const id = guidToId(entry.guid);
	if (!title || !id) return null;

	const attrs = asArray(entry['newznab:attr']);
	const size = Number(attrValue(attrs, 'size') ?? entry.enclosure?._length ?? 0);

	return { id, title, size: Number.isFinite(size) && size > 0 ? size : 0 };
}

/**
 * DrunkenSlug flattens the RSS channel away and puts `item` at the top level;
 * other Newznab servers keep the `channel` wrapper. Accept both, and treat a
 * single-result response (an object, not an array) as a one-item list.
 */
export function parseNewznabResponse(body: unknown): UsenetResult[] {
	const doc = body as { item?: unknown; channel?: { item?: unknown } } | null;
	const raw = doc?.item ?? doc?.channel?.item;
	return asArray(raw as unknown[]).flatMap((item) => {
		const parsed = parseNewznabItem(item);
		return parsed ? [parsed] : [];
	});
}

export interface SearchUsenetParams {
	imdbId: string;
	/** Present for a show season, absent for a movie. */
	seasonNum?: number;
	/** Show title. Only used to look for season packs, which are found by name. */
	title?: string;
	limit?: number;
}

/** The indexer wants the bare digits, unlike everywhere else in this codebase. */
export function buildSearchUrl({ imdbId, seasonNum, limit = 100 }: SearchUsenetParams): string {
	const params = new URLSearchParams({
		apikey: getNewznabApiKey(),
		o: 'json',
		extended: '1',
		limit: String(limit),
		imdbid: imdbId.replace(/^tt/, ''),
	});
	if (seasonNum !== undefined) {
		params.set('t', 'tvsearch');
		params.set('season', String(seasonNum));
	} else {
		params.set('t', 'movie');
	}
	return `${getNewznabUrl()}?${params}`;
}

/**
 * `t=tvsearch` returns episodes and nothing else — 400 results scanned for one
 * season yielded zero whole-season releases, because every item it returns
 * carries an episode number. Packs are indexed, they just have to be asked for
 * by name.
 *
 * Three phrasings, because each finds packs the others miss (measured on two
 * shows: 1 + 5 + 11 hits with no overlap at all, and 1 + 3 + 10 likewise).
 * `Season N` yields the most, `COMPLETE` is the most precise, and the bare
 * `S0N` form still turns up large releases the other two never show.
 */
export function buildPackQueries(title: string, seasonNum: number): string[] {
	const padded = `S${String(seasonNum).padStart(2, '0')}`;
	return [`${title} ${padded}`, `${title} ${padded} COMPLETE`, `${title} Season ${seasonNum}`];
}

export function buildTextSearchUrl(query: string, limit = 100): string {
	const params = new URLSearchParams({
		apikey: getNewznabApiKey(),
		o: 'json',
		extended: '1',
		limit: String(limit),
		t: 'search',
		cat: '5000', // TV
		q: query,
	});
	return `${getNewznabUrl()}?${params}`;
}

async function fetchResults(url: string): Promise<UsenetResult[]> {
	const response = await fetch(url, {
		headers: { Accept: 'application/json' },
		signal: AbortSignal.timeout(20000),
	});
	if (!response.ok) throw new Error(`indexer returned ${response.status}`);
	return parseNewznabResponse(await response.json());
}

/**
 * Whole-season releases for one season. Best-effort: a failing phrasing is
 * skipped rather than failing the whole search, since the episode list is the
 * part users cannot do without.
 */
export async function searchSeasonPacks(title: string, seasonNum: number): Promise<UsenetResult[]> {
	const found = new Map<string, UsenetResult>();
	const perQuery = await Promise.all(
		buildPackQueries(title, seasonNum).map((query) =>
			fetchResults(buildTextSearchUrl(query)).catch((error) => {
				console.error(`Usenet pack query failed (${query}):`, error);
				return [] as UsenetResult[];
			})
		)
	);
	for (const result of perQuery.flat()) {
		if (isSeasonPack(result.title, seasonNum)) {
			found.set(result.id, { ...result, isPack: true });
		}
	}
	return [...found.values()];
}

export async function searchUsenet(params: SearchUsenetParams): Promise<UsenetResult[]> {
	const episodes = await fetchResults(buildSearchUrl(params));

	// Movies have no pack concept, and without a title there is nothing to ask by.
	if (params.seasonNum === undefined || !params.title) return episodes;

	const packs = await searchSeasonPacks(params.title, params.seasonNum);
	const seen = new Set(episodes.map((e) => e.id));
	return [...packs.filter((p) => !seen.has(p.id)), ...episodes];
}

/** Download one NZB by indexer id. Returns the raw XML. */
export async function fetchNzb(id: string): Promise<string> {
	const params = new URLSearchParams({ t: 'get', id, apikey: getNewznabApiKey() });
	const response = await fetch(`${getNewznabUrl()}?${params}`, {
		signal: AbortSignal.timeout(30000),
	});
	if (!response.ok) throw new Error(`NZB download returned ${response.status}`);
	return response.text();
}

export interface Nzb2rdJob {
	id: string;
	status: string;
	name?: string | null;
	error?: string | null;
}

/**
 * Put an already-built torrent into someone's Real-Debrid account by hash.
 *
 * Only worth calling once the job that produced it has finished: at that point
 * RD holds the content, so the add resolves out of its cache instead of looking
 * for seeders — which matters, because an nzb2rd torrent is webseed-only and has
 * no announce or DHT presence to fall back on.
 *
 * `bare` throughout: this runs server-side, so it talks to RD directly rather
 * than through the browser's CORS proxy.
 */
export async function addHashToRdAccount(rdKey: string, hash: string): Promise<string> {
	const id = await addHashAsMagnet(rdKey, hash, true);
	const info = await getTorrentInfo(rdKey, id, true);

	// Mirrors handleSelectFilesInRd: videos if there are any, otherwise everything.
	let selected = info.files.filter(isVideo).map((file: { id: number }) => `${file.id}`);
	if (selected.length === 0) {
		selected = info.files.map((file: { id: number }) => `${file.id}`);
	}
	if (selected.length > 0) await selectFiles(rdKey, id, selected, true);

	return id;
}

/**
 * Hand an NZB to nzb2rd. `rdKey` is per-job, so the release lands in the
 * submitter's own Real-Debrid account rather than the operator's.
 */
export async function submitNzb(args: {
	nzbText: string;
	nzbName: string;
	imdbId: string;
	rdKey: string;
}): Promise<{ status: number; data: any }> {
	const form = new FormData();
	form.append('nzb', new Blob([args.nzbText], { type: 'application/x-nzb' }), args.nzbName);
	form.append('imdb_id', args.imdbId);
	form.append('rd_api_key', args.rdKey);

	const response = await fetch(`${getNzb2rdUrl()}/jobs`, {
		method: 'POST',
		body: form,
		signal: AbortSignal.timeout(30000),
	});
	const data = await response.json().catch(() => ({}));
	return { status: response.status, data };
}
