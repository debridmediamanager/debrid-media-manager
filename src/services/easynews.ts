// Easynews searches and links for the Usenet tab, made with the visitor's own
// account. Easynews forbids sharing an account and may flag one seen from
// conflicting IPs (its agreement and help centre, read 2026-10-25), so DMM never
// holds a login of its own here: each call carries the caller's.
//
// Its search has no CORS headers, so a browser cannot call it directly and these
// requests go out from DMM's server, as RD's do.

import { MAX_NZB_BYTES } from '@/services/sabnzbdProxy';

const EASYNEWS_BASE = 'https://members.easynews.com';
const SEARCH_URL = `${EASYNEWS_BASE}/2.0/search/solr-search/`;
// ponytail: every search measured on 2026-10-25 answered dlFarm "auto" and port
// 443; read downURL/dlFarm/dlPort from the response if that ever varies.
const DOWNLOAD_BASE = `${EASYNEWS_BASE}/dl/auto/443/`;
const TIMEOUT_MS = 20_000;
// Easynews' largest page (pby 5000 still answered 1,000 rows, 2026-11-07). Five pages
// cover The Office S02's 2,454 hits; past that a title's own name is too common to help.
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;
// A 126 GB remux's NZB measured 16.8 MB (2026-11-07), past what 20 s always fetches.
const NZB_TIMEOUT_MS = 60_000;
/** The opaque-id prefix NZBs fetched from Easynews are stored and served under. */
export const EASYNEWS_NZB_PREFIX = 'en';

export interface EasynewsCredentials {
	username: string;
	password: string;
}

export interface EasynewsResult {
	/** `{hash}{ext}/{name}{ext}`: the part of the download URL after the farm and port. */
	path: string;
	title: string;
	size: number;
	/** The search row's signature, without which dl-nzb answers an empty NZB. */
	sig?: string;
}

export interface EasynewsTarget {
	title: string;
	year?: string;
	seasonNum?: number;
	/** A show's TMDB origin countries (ISO codes), so The.Office.PL stays off The Office (US). */
	countries?: string[];
}

/** The caller's own Easynews login, from a POST body so it stays out of URLs and access logs. */
export function readCredentials(body: unknown): EasynewsCredentials | null {
	const { username, password } = (body ?? {}) as Record<string, unknown>;
	if (typeof username !== 'string' || typeof password !== 'string') return null;
	if (!username.trim() || !password || username.length > 200 || password.length > 200)
		return null;
	return { username: username.trim(), password };
}

export class EasynewsAuthError extends Error {
	constructor() {
		super('Easynews rejected the username or password');
		this.name = 'EasynewsAuthError';
	}
}

interface EasynewsRow {
	'0'?: string;
	'10'?: string;
	'11'?: string;
	sig?: string;
	rawSize?: number;
	runtime?: number;
	passwd?: boolean;
	virus?: boolean;
}

export function searchQuery({ title: rawTitle, year, seasonNum }: EasynewsTarget): string {
	// ":" gets an empty 200 body, "?" no hits and "!" unrelated ones (2026-11-07);
	// matchesTarget ignores punctuation, so nothing is lost by dropping them.
	const title = rawTitle.replace(/[:?!]/g, ' ').replace(/\s+/g, ' ').trim();
	if (seasonNum !== undefined) return `${title} S${String(seasonNum).padStart(2, '0')}`;
	return year ? `${title} ${year}` : title;
}

const words = (s: string) =>
	s
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

/**
 * Easynews matches words anywhere and loosely: "game of thrones S03" also finds
 * "Game.of.Leopard.Thrones.S01E03" and "Digging.Up.Britains.Past.S02E03.Game.of.Thrones".
 * A release must start with the title and carry the year or an episode of the season.
 * Samples are dropped by name: most run 60-70 s, past any runtime cut that keeps
 * short episodes (all of GoT S03 on 2026-10-25 was such samples).
 */
export function matchesTarget(
	name: string,
	{ title, year, seasonNum, countries }: EasynewsTarget
): boolean {
	const n = words(name);
	const t = words(title);
	if (!t || !(n === t || n.startsWith(`${t} `))) return false;
	const rest = n.slice(t.length);
	if (/\bsample\b/.test(rest)) return false;
	// Straight after the title, or "Cocaine.Bear.The.True.Story.2023" passes for the film.
	// A show may carry its year or country first: Severance.2022.S02E01, The.Office.US.S02E01.
	// Another country's tag is another show (The.Office.PL), so once the show's own are
	// known only those pass; releases write GB as UK.
	if (seasonNum !== undefined) {
		const m = new RegExp(`^(?: (\\d{4}|[a-z]{2}))? s0*${seasonNum}e\\d+`).exec(rest);
		const tag = m?.[1];
		if (!m || !tag || /^\d/.test(tag) || !countries?.length) return !!m;
		return countries.some((c) => {
			const code = c.toLowerCase();
			return tag === code || (code === 'gb' && tag === 'uk');
		});
	}
	return !year || new RegExp(`^ ${year}\\b`).test(rest);
}

export function toResults(rows: EasynewsRow[], target: EasynewsTarget): EasynewsResult[] {
	const results: EasynewsResult[] = [];
	const seen = new Set<string>();
	for (const row of rows) {
		const hash = row['0'];
		const name = row['10'];
		const ext = row['11'];
		if (!hash || !name || !ext || row.passwd || row.virus) continue;
		// Clips and trailers: a minute is shorter than any episode or film.
		if (typeof row.runtime === 'number' && row.runtime < 60) continue;
		if (!matchesTarget(name, target) || seen.has(hash)) continue;
		seen.add(hash);
		results.push({
			path: `${hash}${ext}/${name}${ext}`,
			title: name,
			size: row.rawSize ?? 0,
			sig: row.sig,
		});
	}
	return results;
}

export class EasynewsGoneError extends Error {
	constructor() {
		super('this file is no longer available');
		this.name = 'EasynewsGoneError';
	}
}

export class EasynewsNzbError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'EasynewsNzbError';
	}
}

const authHeader = ({ username, password }: EasynewsCredentials) =>
	`Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

export async function searchEasynews(
	credentials: EasynewsCredentials,
	target: EasynewsTarget
): Promise<EasynewsResult[]> {
	const params = new URLSearchParams({
		gps: searchQuery(target),
		'fty[]': 'VIDEO',
		pby: String(PAGE_SIZE),
		s1: 'dsize',
		s1d: '-',
		u: '1',
		safeO: '0',
		// The web app's own flags: fly=2 asks for JSON, st=basic the keyword search.
		fly: '2',
		sb: '1',
		st: 'basic',
		chxu: '1',
		chxgx: '1',
	});
	const rows: EasynewsRow[] = [];
	// One page at a time: an account has two search slots.
	for (let pno = 1; pno <= MAX_PAGES; pno++) {
		params.set('pno', String(pno));
		let body;
		try {
			const response = await fetch(`${SEARCH_URL}?${params}`, {
				headers: { Authorization: authHeader(credentials) },
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (response.status === 401 || response.status === 403) throw new EasynewsAuthError();
			if (!response.ok) throw new Error(`Easynews search failed: HTTP ${response.status}`);
			body = await response.json();
		} catch (error) {
			// A later page failing still leaves the larger files already read.
			if (pno === 1 || error instanceof EasynewsAuthError) throw error;
			break;
		}
		if (Array.isArray(body?.data)) rows.push(...body.data);
		if (!(Number(body?.numPages) > pno)) break;
	}
	return toResults(rows, target);
}

/**
 * Whether Easynews takes this login. Its members page answers 200 or 401 (2026-10-25)
 * and, unlike a search, does not take one of the account's two search slots.
 */
export async function checkEasynewsLogin(credentials: EasynewsCredentials): Promise<void> {
	const response = await fetch(`${EASYNEWS_BASE}/`, {
		headers: { Authorization: authHeader(credentials) },
		redirect: 'manual',
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (response.status === 401 || response.status === 403) throw new EasynewsAuthError();
	if (!response.ok) throw new Error(`Easynews login check failed: HTTP ${response.status}`);
}

const PATH_RE = /^[0-9a-f]{20,80}\.[A-Za-z0-9]{1,6}\/[^/?#\\]{1,300}$/;

export const isEasynewsPath = (path: unknown): path is string =>
	typeof path === 'string' && PATH_RE.test(path);

/**
 * Trades a result for the signed link Easynews redirects to. That link needs no
 * login and is new on every call, so the visitor's password never reaches their
 * player.
 */
export async function resolveEasynewsLink(
	credentials: EasynewsCredentials,
	path: string
): Promise<string> {
	const [file, name] = path.split('/');
	const response = await fetch(`${DOWNLOAD_BASE}${file}/${encodeURIComponent(name)}`, {
		headers: { Authorization: authHeader(credentials), Range: 'bytes=0-0' },
		redirect: 'manual',
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (response.status === 401 || response.status === 403) throw new EasynewsAuthError();
	const location = response.headers.get('location');
	if (response.status < 300 || response.status >= 400 || !location) {
		throw new Error(`Easynews did not hand out a link: HTTP ${response.status}`);
	}
	const url = new URL(location, DOWNLOAD_BASE);
	if (url.protocol !== 'https:' || !/(^|\.)easynews\.com$/i.test(url.hostname)) {
		throw new Error('Easynews redirected outside easynews.com');
	}
	// Easynews still lists some files it can no longer serve, and their signed link
	// answers 404 (2026-11-07). One byte tells, before a player gets a 404 page.
	const probe = await fetch(url.toString(), {
		headers: { Range: 'bytes=0-0' },
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	await probe.body?.cancel();
	if (probe.status === 404 || probe.status === 410) throw new EasynewsGoneError();
	return url.toString();
}

/** The hash, name and extension a result path is built from. */
export function splitEasynewsPath(path: string): { hash: string; name: string; ext: string } {
	const [file, fileName] = path.split('/');
	const dot = file.indexOf('.');
	const ext = file.slice(dot);
	const name = fileName.endsWith(ext) ? fileName.slice(0, -ext.length) : fileName;
	return { hash: file.slice(0, dot), name, ext };
}

/**
 * A result's NZB, as the web app's "NZB" button fetches it (2026-11-07). The form
 * field's name really is `0&sig=<sig>`. Without a valid sig Easynews answers 200
 * with an empty `<nzb/>`, so an answer with no `<file>` is refused.
 */
export async function fetchEasynewsNzb(
	credentials: EasynewsCredentials,
	path: string,
	sig: string
): Promise<string> {
	const { hash, name, ext } = splitEasynewsPath(path);
	const b64 = (s: string) => Buffer.from(s).toString('base64');
	const response = await fetch(`${EASYNEWS_BASE}/2.0/api/dl-nzb`, {
		method: 'POST',
		headers: {
			Authorization: authHeader(credentials),
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			autoNZB: '1',
			[`0&sig=${sig}`]: `${hash}|${b64(name)}:${b64(ext)}`,
		}).toString(),
		signal: AbortSignal.timeout(NZB_TIMEOUT_MS),
	});
	if (response.status === 401 || response.status === 403) throw new EasynewsAuthError();
	if (!response.ok) throw new Error(`Easynews NZB failed: HTTP ${response.status}`);
	const tooLarge = () => new EasynewsNzbError('This NZB is too large to send');
	if (Number(response.headers.get('content-length')) > MAX_NZB_BYTES) throw tooLarge();
	const xml = await response.text();
	if (Buffer.byteLength(xml) > MAX_NZB_BYTES) throw tooLarge();
	if (!xml.includes('<file')) {
		throw new EasynewsNzbError('Easynews did not hand out this NZB; search again');
	}
	return xml;
}
