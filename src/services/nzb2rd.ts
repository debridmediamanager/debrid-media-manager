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

export async function searchUsenet(params: SearchUsenetParams): Promise<UsenetResult[]> {
	const response = await fetch(buildSearchUrl(params), {
		headers: { Accept: 'application/json' },
		signal: AbortSignal.timeout(20000),
	});
	if (!response.ok) throw new Error(`indexer returned ${response.status}`);
	return parseNewznabResponse(await response.json());
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
