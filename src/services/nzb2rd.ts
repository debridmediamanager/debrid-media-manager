// Usenet results for a media page, and the hand-off to nzb2rd.
//
// Two kinds of external service sit behind this file, and neither may be
// reached from the browser:
//
//   * The Newznab indexers (DrunkenSlug and altHUB). Their API keys are
//     secrets, and — the part that is easy to miss — every `link`/`enclosure`
//     URL in a search response has the key embedded in its `&r=` parameter.
//     Shipping a raw item to the client leaks the key, so `searchUsenet`
//     returns a whitelist of fields and the caller downloads NZBs by opaque id
//     through `fetchNzb`.
//   * nzb2rd itself, which speaks plain HTTP with no CORS and no auth. Its
//     public vhost forwards only /webseed/*, so the management API answers on
//     the Tailscale address alone — same arrangement as the debrid uploader.

import { isVideo } from '@/utils/selectable';
import { addHashAsMagnet, getTorrentInfo, selectFiles } from './realDebrid';

const DEFAULT_NZB2RD_URL = 'http://100.90.231.66:3200'; // dmm over Tailscale
const DEFAULT_NEWZNAB_URL = 'https://drunkenslug.com/api';
const DEFAULT_ALTHUB_URL = 'https://api.althub.co.za/api';

export function getNzb2rdUrl(): string {
	return (process.env.NZB2RD_URL || DEFAULT_NZB2RD_URL).replace(/\/+$/, '');
}

export function getNewznabUrl(): string {
	return (process.env.NEWZNAB_URL || DEFAULT_NEWZNAB_URL).replace(/\/+$/, '');
}

export function getNewznabApiKey(): string {
	return process.env.NEWZNAB_API_KEY || '';
}

/**
 * One Newznab server. `prefix` is embedded in every release id this indexer
 * produces, so it is a stored value — changing one orphans the transfer records
 * and cache entries written under it.
 */
export interface Indexer {
	prefix: string;
	name: string;
	url: string;
	apiKey: string;
}

export const DRUNKENSLUG_PREFIX = 'ds';

/**
 * Every configured indexer, in priority order. An indexer with no API key is
 * left out entirely, so althub stays dormant until its key is set and DMM keeps
 * working exactly as before.
 *
 * DrunkenSlug is first deliberately: on a title collision its id is the one
 * kept, which keeps already-stored transfer records matching (they hold bare
 * DrunkenSlug ids, and `parseReleaseId` reads those as DrunkenSlug).
 */
export function getIndexers(): Indexer[] {
	return [
		{
			prefix: DRUNKENSLUG_PREFIX,
			name: 'DrunkenSlug',
			url: getNewznabUrl(),
			apiKey: getNewznabApiKey(),
		},
		{
			prefix: 'ah',
			name: 'altHUB',
			url: (process.env.ALTHUB_URL || DEFAULT_ALTHUB_URL).replace(/\/+$/, ''),
			apiKey: process.env.ALTHUB_API_KEY || '',
		},
	].filter((indexer) => indexer.apiKey);
}

/**
 * Release ids are indexer-qualified (`ds:abc123`), because the id is the handle
 * for a later `t=get` and two indexers number their releases independently.
 *
 * An unqualified id is read as DrunkenSlug: ids were bare before althub existed
 * and are already stored that way in transfer records and users' localStorage.
 */
export function qualifyReleaseId(prefix: string, nativeId: string): string {
	return `${prefix}:${nativeId}`;
}

export function parseReleaseId(id: string): { indexer: Indexer; nativeId: string } | null {
	const split = id.indexOf(':');
	const prefix = split === -1 ? DRUNKENSLUG_PREFIX : id.slice(0, split);
	const nativeId = split === -1 ? id : id.slice(split + 1);
	if (!nativeId) return null;
	const indexer = getIndexers().find((candidate) => candidate.prefix === prefix);
	return indexer ? { indexer, nativeId } : null;
}

/** The only fields that reach the browser. Deliberately excludes `link`. */
export interface UsenetResult {
	/** Indexer-qualified id (`ds:abc123`), the handle for a later `t=get`. */
	id: string;
	title: string;
	/** Bytes. 0 when the indexer reported no size. */
	size: number;
	/** A whole-season release rather than a single episode. Shows only. */
	isPack?: boolean;
	/** Which indexer supplied it, for the UI badge. */
	indexer?: string;
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

/**
 * The two indexers serialise Newznab JSON differently, and nothing in the spec
 * settles it:
 *
 *   DrunkenSlug (nZEDb)  "newznab:attr": [{ _name: "size", _value: "123" }]
 *                        enclosure:      { _length: "123" }
 *   altHUB               "attr":         [{ "@attributes": { name, value } }]
 *                        enclosure:      { "@attributes": { length: "123" } }
 *
 * Both forms are read here so the rest of the file never has to care which
 * indexer an item came from.
 */
type NewznabAttr =
	| { _name?: string; _value?: string }
	| { '@attributes'?: { name?: string; value?: string } };

function asArray<T>(value: T | T[] | undefined | null): T[] {
	if (Array.isArray(value)) return value;
	return value ? [value] : [];
}

function attrValue(attrs: NewznabAttr[], name: string): string | undefined {
	for (const attr of attrs) {
		const underscore = attr as { _name?: string; _value?: string };
		if (underscore._name === name) return underscore._value;
		const wrapped = (attr as { '@attributes'?: { name?: string; value?: string } })[
			'@attributes'
		];
		if (wrapped?.name === name) return wrapped.value;
	}
	return undefined;
}

function enclosureLength(enclosure: unknown): string | undefined {
	const entry = enclosure as
		| { _length?: string; '@attributes'?: { length?: string } }
		| null
		| undefined;
	return entry?._length ?? entry?.['@attributes']?.length;
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
		attr?: NewznabAttr | NewznabAttr[];
		enclosure?: unknown;
	} | null;
	if (!entry) return null;

	const title = typeof entry.title === 'string' ? entry.title.trim() : '';
	const id = guidToId(entry.guid);
	if (!title || !id) return null;

	const attrs = asArray(entry['newznab:attr'] ?? entry.attr);
	const size = Number(attrValue(attrs, 'size') ?? enclosureLength(entry.enclosure) ?? 0);

	return { id, title, size: Number.isFinite(size) && size > 0 ? size : 0 };
}

/**
 * DrunkenSlug flattens the RSS channel away and puts `item` at the top level;
 * altHUB and other Newznab servers keep the `channel` wrapper. Accept both, and
 * treat a single-result response (an object, not an array) as a one-item list.
 *
 * Ids come back native (unqualified) — `fetchResults` attaches the indexer,
 * since that is the layer that knows which server answered.
 */
export function parseNewznabResponse(body: unknown): UsenetResult[] {
	const doc = body as { item?: unknown; channel?: { item?: unknown } } | null;
	const raw = doc?.item ?? doc?.channel?.item;
	return asArray(raw as unknown[]).flatMap((item) => {
		const parsed = parseNewznabItem(item);
		return parsed ? [parsed] : [];
	});
}

/**
 * Dedup key for the same release seen on two indexers.
 *
 * Title only — measured, not assumed. Adding an exact-size match on top caught
 * essentially nothing extra (49→49 and 82→82 on two sampled seasons) and did
 * produce false merges: a `S02` pack and a `S02E01` episode both reporting
 * 66.52 GB would collapse into one. A ±0.5% size window is worse still, folding
 * 82 distinct releases down to 73, because separate encodes of the same content
 * routinely land within half a percent of each other. So size is for sorting and
 * display, never for deciding two rows are the same release.
 *
 * The normalisation has to be aggressive because the indexers format titles
 * differently — `The.Matrix.1999.1080p.BluRay.x264` against
 * `The Matrix (1999) (1080p BluRay x264)`.
 */
export function releaseDedupKey(title: string): string {
	return title
		.toLowerCase()
		.replace(/\.(mkv|mp4|avi|nzb)$/, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

export interface SearchUsenetParams {
	imdbId: string;
	/** Present for a show season, absent for a movie. */
	seasonNum?: number;
	/** Show title. Only used to look for season packs, which are found by name. */
	title?: string;
	/** TVDB series id, when one could be resolved. Shows only — see below. */
	tvdbId?: number;
	limit?: number;
}

/**
 * The indexer wants the bare digits, unlike everywhere else in this codebase.
 *
 * A season goes out keyed on the TVDB id whenever one is known, because the
 * indexer matches TV releases against TVDB: every item comes back carrying a
 * `tvdbid` attribute and no imdb one, and the imdb↔tvdb mapping lags for weeks
 * on a newly premiered show. Measured over the 14 most popular shows that
 * premiered in the three months to 2026-08-08, all of them mid-season: `imdbid`
 * returned nothing for every single one, while `tvdbid` returned 49–100 results
 * for the same seasons. Long-running shows return identical counts either way,
 * so TVDB is never the worse key.
 *
 * Only ever one id — sending both was not measured across enough titles to know
 * whether the indexer ORs or ANDs them. Movies stay on IMDb: `t=movie` takes no
 * other id (`caps` lists `q,imdbid`), and their mapping is not affected.
 */
export function buildSearchUrl(
	{ imdbId, seasonNum, tvdbId, limit = 100 }: SearchUsenetParams,
	indexer: Indexer = getIndexers()[0]
): string {
	const params = new URLSearchParams({
		apikey: indexer.apiKey,
		o: 'json',
		extended: '1',
		limit: String(limit),
	});
	if (seasonNum !== undefined) {
		params.set('t', 'tvsearch');
		params.set('season', String(seasonNum));
	} else {
		params.set('t', 'movie');
	}
	if (seasonNum !== undefined && tvdbId !== undefined) {
		params.set('tvdbid', String(tvdbId));
	} else {
		params.set('imdbid', imdbId.replace(/^tt/, ''));
	}
	return `${indexer.url}?${params}`;
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

export function buildTextSearchUrl(
	query: string,
	limit = 100,
	indexer: Indexer = getIndexers()[0]
): string {
	const params = new URLSearchParams({
		apikey: indexer.apiKey,
		o: 'json',
		extended: '1',
		limit: String(limit),
		t: 'search',
		cat: '5000', // TV
		q: query,
	});
	return `${indexer.url}?${params}`;
}

async function fetchResults(url: string, indexer: Indexer): Promise<UsenetResult[]> {
	const response = await fetch(url, {
		headers: { Accept: 'application/json' },
		signal: AbortSignal.timeout(20000),
	});
	if (!response.ok) throw new Error(`${indexer.name} returned ${response.status}`);

	// altHUB answers a bad key with `<error code="100" …/>` and HTTP 200, ignoring
	// `o=json` entirely. The raw parse failure reads as an unexpected `<`, which
	// looks like a transport fault rather than a credential problem — so say what
	// it actually means, since a wrong key would otherwise present as this
	// indexer being permanently unreachable.
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new Error(
			`${indexer.name} returned a non-JSON body — usually a Newznab <error> envelope, so check its API key`
		);
	}

	// Qualify here: this is the only layer that knows which server answered.
	return parseNewznabResponse(payload).map((result) => ({
		...result,
		id: qualifyReleaseId(indexer.prefix, result.id),
		indexer: indexer.name,
	}));
}

/**
 * Merge results from several indexers, keeping the first of each release.
 * Callers pass lists in indexer priority order, so "first" means "from the
 * preferred indexer" and the choice is deterministic across requests — the same
 * release always shows the same id, which is what the transfer dedup keys on.
 */
export function dedupeResults(lists: UsenetResult[][]): UsenetResult[] {
	const byRelease = new Map<string, UsenetResult>();
	for (const result of lists.flat()) {
		const key = releaseDedupKey(result.title);
		if (!byRelease.has(key)) byRelease.set(key, result);
	}
	return [...byRelease.values()];
}

/**
 * Run one query shape against every indexer at once. Best-effort per indexer:
 * one being down degrades coverage instead of emptying the page. `ok` reports
 * whether *any* indexer answered, so a total outage can still be told apart
 * from a genuine no-results.
 */
async function fanOut(
	toUrl: (indexer: Indexer) => string,
	label: string
): Promise<{ ok: boolean; lists: UsenetResult[][] }> {
	const indexers = getIndexers();
	const settled = await Promise.all(
		indexers.map((indexer) =>
			fetchResults(toUrl(indexer), indexer)
				.then((results) => ({ ok: true, results }))
				.catch((error) => {
					console.error(`Usenet ${label} failed on ${indexer.name}:`, error);
					return { ok: false, results: [] as UsenetResult[] };
				})
		)
	);
	return { ok: settled.some((s) => s.ok), lists: settled.map((s) => s.results) };
}

/**
 * Whole-season releases for one season, across every indexer. Best-effort: a
 * failing phrasing is skipped rather than failing the whole search, since the
 * episode list is the part users cannot do without.
 */
export async function searchSeasonPacks(title: string, seasonNum: number): Promise<UsenetResult[]> {
	const perQuery = await Promise.all(
		buildPackQueries(title, seasonNum).map((query) =>
			fanOut((indexer) => buildTextSearchUrl(query, 100, indexer), `pack query (${query})`)
		)
	);
	const packs = perQuery
		.flatMap((result) => result.lists)
		.map((list) => list.filter((r) => isSeasonPack(r.title, seasonNum)));
	return dedupeResults(packs).map((pack) => ({ ...pack, isPack: true }));
}

export async function searchUsenet(params: SearchUsenetParams): Promise<UsenetResult[]> {
	const { ok, lists } = await fanOut((indexer) => buildSearchUrl(params, indexer), 'search');
	// Every indexer failing is an outage, not an empty result — throw so the
	// caller can fall back to its cached copy rather than storing "nothing".
	if (!ok) throw new Error('no indexer could be reached');
	const episodes = dedupeResults(lists);

	// Movies have no pack concept, and without a title there is nothing to ask by.
	if (params.seasonNum === undefined || !params.title) return episodes;

	const packs = await searchSeasonPacks(params.title, params.seasonNum);
	const seen = new Set(episodes.map((e) => releaseDedupKey(e.title)));
	return [...packs.filter((p) => !seen.has(releaseDedupKey(p.title))), ...episodes];
}

/**
 * Newznab's error envelope, which altHUB returns with **HTTP 200** — a bad key
 * is `<error code="100" description="Incorrect user credentials"/>` and a dead
 * release id is `<error code="300" description="No such item"/>`, both 200.
 *
 * So status alone cannot be trusted here. Without this check `fetchNzb` returns
 * the error document as if it were an NZB, and the caller cheerfully posts it to
 * nzb2rd: the submission fails there instead, reported as a broken NZB rather
 * than "the indexer no longer has this release".
 */
export function newznabError(body: string): string | null {
	const match = body.slice(0, 400).match(/<error\s[^>]*code="(\d+)"[^>]*description="([^"]*)"/);
	return match ? `${match[2]} (code ${match[1]})` : null;
}

/**
 * Download one NZB by qualified release id. Returns the raw XML.
 *
 * altHUB answers `t=get` with a 302 to its own `/getnzb` path; `fetch` follows
 * redirects by default, so both indexers work through the same call.
 */
export async function fetchNzb(id: string): Promise<string> {
	const target = parseReleaseId(id);
	if (!target) throw new Error(`unknown indexer for release id ${id}`);
	const params = new URLSearchParams({
		t: 'get',
		id: target.nativeId,
		apikey: target.indexer.apiKey,
	});
	const response = await fetch(`${target.indexer.url}?${params}`, {
		signal: AbortSignal.timeout(30000),
	});
	if (!response.ok) throw new Error(`NZB download returned ${response.status}`);
	const body = await response.text();
	const failed = newznabError(body);
	if (failed) throw new Error(`${target.indexer.name} refused the NZB: ${failed}`);
	return body;
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

/** Long-lived Real-Debrid OAuth credentials, as `rdTokenStorage` holds them. */
export interface RdOAuthCredentials {
	clientId: string;
	clientSecret: string;
	refreshToken: string;
}

/** All three present? A partial triple cannot mint anything, so it is not sent. */
export function isCompleteOAuth(value: unknown): value is RdOAuthCredentials {
	const creds = value as Partial<RdOAuthCredentials> | null | undefined;
	return [creds?.clientId, creds?.clientSecret, creds?.refreshToken].every(
		(part) => typeof part === 'string' && part.length > 0
	);
}

/**
 * Hand an NZB to nzb2rd. `rdKey` is per-job, so the release lands in the
 * submitter's own Real-Debrid account rather than the operator's.
 *
 * **`rdKey` alone is not enough, and this was the top cause of failed Usenet
 * transfers.** It is an OAuth access token, which Real-Debrid expires 24 hours
 * after it is minted, while nzb2rd queues jobs for days — so it was alive here
 * and dead at the hand-off, which surfaced on the Transfers page as
 * `RD addTorrent failed: 401 bad_token` (measured 2026-08-17: 1298 of 1952
 * failures, none of them under an hour of queue wait).
 *
 * The OAuth triple does not expire, so nzb2rd refreshes the token itself when it
 * finally runs. Optional: omitting it leaves the service on the stored token,
 * which is the old behaviour rather than a new failure.
 */
export async function submitNzb(args: {
	nzbText: string;
	nzbName: string;
	imdbId: string;
	rdKey: string;
	oauth?: RdOAuthCredentials | null;
	/**
	 * Admit the job to nzb2rd's priority tier — the sponsor perk.
	 *
	 * Only ever set from `isSponsorRequest`, which checks the HMAC on a token
	 * this app minted. Never from anything the browser supplies directly: the
	 * field nzb2rd reads is a bare boolean, so dmm vouching for it is the whole
	 * verification.
	 *
	 * It reorders the wait; it buys no extra concurrency on that host.
	 */
	priority?: boolean;
}): Promise<{ status: number; data: any }> {
	const form = new FormData();
	form.append('nzb', new Blob([args.nzbText], { type: 'application/x-nzb' }), args.nzbName);
	form.append('imdb_id', args.imdbId);
	form.append('rd_api_key', args.rdKey);
	if (args.priority) form.append('priority', '1');
	if (isCompleteOAuth(args.oauth)) {
		form.append('rd_client_id', args.oauth.clientId);
		form.append('rd_client_secret', args.oauth.clientSecret);
		form.append('rd_refresh_token', args.oauth.refreshToken);
	}

	const response = await fetch(`${getNzb2rdUrl()}/jobs`, {
		method: 'POST',
		body: form,
		signal: AbortSignal.timeout(30000),
	});
	const data = await response.json().catch(() => ({}));
	return { status: response.status, data };
}
