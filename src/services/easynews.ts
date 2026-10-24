// Easynews searches and links for the Usenet tab, made with the visitor's own
// account. Easynews forbids sharing an account and may flag one seen from
// conflicting IPs (its agreement and help centre, read 2026-10-25), so DMM never
// holds a login of its own here: each call carries the caller's.
//
// Its search has no CORS headers, so a browser cannot call it directly and these
// requests go out from DMM's server, as RD's do.

const EASYNEWS_BASE = 'https://members.easynews.com';
const SEARCH_URL = `${EASYNEWS_BASE}/2.0/search/solr-search/`;
// ponytail: every search measured on 2026-10-25 answered dlFarm "auto" and port
// 443; read downURL/dlFarm/dlPort from the response if that ever varies.
const DOWNLOAD_BASE = `${EASYNEWS_BASE}/dl/auto/443/`;
const TIMEOUT_MS = 20_000;

export interface EasynewsCredentials {
	username: string;
	password: string;
}

export interface EasynewsResult {
	/** `{hash}{ext}/{name}{ext}`: the part of the download URL after the farm and port. */
	path: string;
	title: string;
	size: number;
}

export interface EasynewsTarget {
	title: string;
	year?: string;
	seasonNum?: number;
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
	rawSize?: number;
	runtime?: number;
	passwd?: boolean;
	virus?: boolean;
}

export function searchQuery({ title, year, seasonNum }: EasynewsTarget): string {
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
export function matchesTarget(name: string, { title, year, seasonNum }: EasynewsTarget): boolean {
	const n = words(name);
	const t = words(title);
	if (!t || !(n === t || n.startsWith(`${t} `))) return false;
	const rest = n.slice(t.length);
	if (/\bsample\b/.test(rest)) return false;
	// Straight after the title, or "Cocaine.Bear.The.True.Story.2023" passes for the film.
	// A show may carry its year or country first: Severance.2022.S02E01, The.Office.US.S02E01.
	if (seasonNum !== undefined) {
		return new RegExp(`^(?: (?:\\d{4}|[a-z]{2}))? s0*${seasonNum}e\\d+`).test(rest);
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
		results.push({ path: `${hash}${ext}/${name}${ext}`, title: name, size: row.rawSize ?? 0 });
	}
	return results;
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
		pno: '1',
		pby: '250',
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
	const response = await fetch(`${SEARCH_URL}?${params}`, {
		headers: { Authorization: authHeader(credentials) },
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (response.status === 401 || response.status === 403) throw new EasynewsAuthError();
	if (!response.ok) throw new Error(`Easynews search failed: HTTP ${response.status}`);
	const body = await response.json();
	return toResults(Array.isArray(body?.data) ? body.data : [], target);
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
	return url.toString();
}
