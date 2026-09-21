import getConfig from 'next/config';

/**
 * Simkl AUTH V2 and the Custom Lists API.
 *
 * Two things make this different from every other login in DMM, and both come
 * from Simkl rather than from us:
 *
 *  - **A V2 `client_id` is useless on its own.** Under AUTH V1 an app key alone
 *    reached the catalog and search; under V2 every endpoint except the
 *    Cloudflare-cached catalog files answers `401 user_token_required` without a
 *    bearer token - verified against production on 2026-09-21, including
 *    `/users/settings` and `/lists/*`. The Custom Lists guide describes an
 *    anonymous caller as "treated as a free account" and answered with the
 *    `premium_only` body below; that is V1 behaviour, and a V2 key does not get
 *    that far. So there is no anonymous mode here - nothing is attempted until
 *    the user has signed in.
 *  - **Custom Lists is a paid feature that answers HTTP 200 when it refuses.**
 *    See `SimklError` and `readSimklBody`.
 *
 * This is deliberately browser-side. `api.simkl.com` sends
 * `Access-Control-Allow-Origin: *` and names `Authorization` in its allowed
 * request headers (verified live), the registered client is a public one with no
 * secret, and AUTH V2 meters requests against the signed-in user rather than
 * against one shared per-app budget. Proxying through dmm-01 would therefore buy
 * nothing and would put every user's Simkl traffic behind one IP - the shape
 * that has already cost us once with TorBox.
 *
 * `User-Agent` is not set anywhere in this file on purpose: it is a forbidden
 * header name in browsers, and Simkl's own CORS guide says to identify a browser
 * app with the `app-name` / `app-version` URL parameters instead.
 *
 * Not to be confused with `services/anime/simkl.ts`, which resolves an anime's
 * IMDb id from a V1 `client_id` with no user token at all. The two cannot share
 * a key: a V2 id fails there, and a V1 id cannot reach Custom Lists.
 */

export const SIMKL_API_URL = 'https://api.simkl.com';
export const SIMKL_AUTHORIZE_URL = 'https://simkl.com/oauth2/authorize';
export const SIMKL_TOKEN_URL = `${SIMKL_API_URL}/oauth2/token`;

/**
 * The path Simkl redirects back to. It is registered against the client id, so
 * it is a constant rather than a setting - an instance serving DMM from another
 * origin needs its own V2 client id with its own redirect registered.
 */
export const SIMKL_REDIRECT_PATH = '/auth/simkl';

/**
 * Identifies the app in Simkl's request log. Simkl asks for these on every call,
 * including unauthenticated ones; they are analytics, not credentials, and the
 * version does not have to track `package.json` release for release.
 */
const APP_NAME = 'debridmediamanager';
const APP_VERSION = '4.0';

/** Read-only is all the Custom Lists API offers today; writes are web-only. */
export const SIMKL_SCOPE = 'media:read';

/** Simkl's own ceiling: `page` times `limit` may not exceed 10000. */
const MAX_WINDOW = 10000;
/** The documented maximum. Fewer round trips for a 2,000-item PRO list. */
const PAGE_SIZE = 500;

/**
 * Read at call time, not at import time. Destructuring `getConfig()` in module
 * scope - which `services/trakt.ts` does - throws outright wherever there is no
 * Next runtime to answer it, which takes the whole module down with it.
 */
export const getSimklClientId = (): string | null =>
	getConfig()?.publicRuntimeConfig?.simklClientId || null;

export interface SimklTokens {
	access_token: string;
	token_type: string;
	/** Seconds. 604800 (7 days) at the time of writing. */
	expires_in: number;
	/** Lasts 180 days and is renewed each time it is used. */
	refresh_token?: string;
	scope?: string;
}

export interface SimklUser {
	user: {
		name: string;
		joined_at?: string;
		gender?: string;
		avatar?: string;
		bio?: string;
		loc?: string;
		age?: number;
	};
	account: {
		id: number;
		timezone?: string;
		/** `free` cannot read Custom Lists - see `SimklError`. */
		type: 'free' | 'pro' | 'vip';
	};
}

export interface SimklListIds {
	simkl_id: number;
	slug?: string;
	imdb?: string;
	tmdb?: string;
	tvdb?: string;
	tvdbslug?: string;
	traktslug?: string;
}

export interface SimklListItem {
	title: string;
	year?: number;
	/** `movie`, `tv` or `anime`. */
	type: string;
	poster?: string;
	ids: SimklListIds;
	position?: number;
}

export interface SimklListSummary {
	id: number;
	name: string;
	slug?: string;
	description?: { short: string | null; full: string | null };
	/** `movies`, `tv` or `anime`. */
	media_type?: string;
	type?: string;
	privacy?: string;
	user?: { id: number; name: string; avatar?: string };
	counts?: { items: number; likes: number; followers: number; comments: number };
	updated_at?: string;
	created_at?: string;
	/** Only present when reading your own lists. */
	pinned?: boolean;
}

export interface SimklList extends SimklListSummary {
	items: SimklListItem[];
}

export const SIMKL_PREMIUM_ONLY = 'premium_only';
export const SIMKL_TOKEN_REQUIRED = 'user_token_required';

/**
 * Anything Simkl refused, whatever status it used to say so.
 *
 * The status code alone cannot carry this. A free or anonymous caller asking for
 * a custom list gets **HTTP 200** with `{"error":"premium_only", ...}` - no
 * `items`, no `pagination`, and a singular `item` that is a renderable
 * "Upgrade to Simkl PRO/VIP" placeholder complete with a poster URL. A client
 * that branches on `response.ok` renders that placeholder as though it were a
 * title the user had added. So every body is inspected for an `error` key
 * whether or not the response was ok, and this is thrown either way.
 */
export class SimklError extends Error {
	readonly code: string;
	readonly status: number;

	constructor(code: string, message: string, status: number) {
		super(message);
		this.name = 'SimklError';
		this.code = code;
		this.status = status;
	}

	/** The user is signed in but not on PRO or VIP. */
	get isPremiumOnly(): boolean {
		return this.code === SIMKL_PREMIUM_ONLY;
	}

	/** The token is missing, expired or revoked - the caller should refresh. */
	get isUnauthorized(): boolean {
		return this.status === 401 || this.code === SIMKL_TOKEN_REQUIRED;
	}
}

type Fetcher = typeof fetch;

const base64url = (bytes: Uint8Array): string => {
	let binary = '';
	bytes.forEach((b) => {
		binary += String.fromCharCode(b);
	});
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/**
 * A fresh PKCE verifier: 32 random bytes, base64url-encoded to 43 characters,
 * which sits inside RFC 7636's 43-128 range with no padding to strip later.
 */
export function createCodeVerifier(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return base64url(bytes);
}

/** S256 is the only method Simkl accepts, and it is mandatory on every V2 call. */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return base64url(new Uint8Array(digest));
}

/** Opaque value echoed back on the redirect, so a stray `code` cannot be replayed. */
export const createState = (): string => createCodeVerifier();

export function buildSimklAuthorizeUrl(params: {
	clientId: string;
	redirectUri: string;
	codeChallenge: string;
	state: string;
	scope?: string;
}): string {
	const query = new URLSearchParams({
		response_type: 'code',
		client_id: params.clientId,
		redirect_uri: params.redirectUri,
		code_challenge: params.codeChallenge,
		code_challenge_method: 'S256',
		state: params.state,
		scope: params.scope ?? SIMKL_SCOPE,
	});
	return `${SIMKL_AUTHORIZE_URL}?${query.toString()}`;
}

/**
 * Parses a Simkl response and throws unless it carries usable data.
 *
 * `error` is checked before the status because of the `premium_only` 200
 * described on `SimklError`; a non-JSON body is reported as the status rather
 * than thrown as a `SyntaxError`, which says nothing useful to the user.
 */
async function readSimklBody<T>(response: Response): Promise<T> {
	const text = await response.text();
	let body: any;
	try {
		body = text ? JSON.parse(text) : {};
	} catch {
		throw new SimklError(
			'non_json_response',
			`Simkl answered ${response.status} with a non-JSON body`,
			response.status
		);
	}

	if (body && typeof body === 'object' && typeof body.error === 'string') {
		throw new SimklError(
			body.error,
			body.message || body.error_description || body.error,
			typeof body.code === 'number' ? body.code : response.status
		);
	}
	if (!response.ok) {
		throw new SimklError('http_error', `Simkl answered ${response.status}`, response.status);
	}
	return body as T;
}

const withAppParams = (path: string, clientId: string, params: Record<string, string> = {}) => {
	const query = new URLSearchParams({
		client_id: clientId,
		'app-name': APP_NAME,
		'app-version': APP_VERSION,
		...params,
	});
	return `${SIMKL_API_URL}${path}?${query.toString()}`;
};

async function simklGet<T>(
	path: string,
	token: string,
	params: Record<string, string> = {},
	fetcher: Fetcher = fetch
): Promise<T> {
	const clientId = getSimklClientId();
	if (!clientId) {
		throw new SimklError('not_configured', 'No Simkl client id is configured', 0);
	}
	// No Content-Type on a GET: it would turn a preflight-once request into a
	// preflighted one for a body that does not exist.
	const response = await fetcher(withAppParams(path, clientId, params), {
		headers: { Authorization: `Bearer ${token}` },
	});
	return readSimklBody<T>(response);
}

async function simklTokenRequest(
	body: Record<string, string>,
	fetcher: Fetcher = fetch
): Promise<SimklTokens> {
	const clientId = getSimklClientId();
	if (!clientId) {
		throw new SimklError('not_configured', 'No Simkl client id is configured', 0);
	}
	// Form encoding, and no `client_secret`: the registered client is a public
	// one, which is the whole reason PKCE is mandatory. Shipping a secret to a
	// browser would publish it.
	const response = await fetcher(SIMKL_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ ...body, client_id: clientId }).toString(),
	});
	return readSimklBody<SimklTokens>(response);
}

export const exchangeSimklCode = (
	params: { code: string; codeVerifier: string; redirectUri: string },
	fetcher: Fetcher = fetch
): Promise<SimklTokens> =>
	simklTokenRequest(
		{
			grant_type: 'authorization_code',
			code: params.code,
			redirect_uri: params.redirectUri,
			code_verifier: params.codeVerifier,
		},
		fetcher
	);

export const refreshSimklToken = (refreshToken: string, fetcher: Fetcher = fetch) =>
	simklTokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }, fetcher);

export const getSimklUser = (token: string, fetcher: Fetcher = fetch): Promise<SimklUser> =>
	simklGet<SimklUser>('/users/settings', token, {}, fetcher);

/**
 * Walks a paginated endpoint to the end.
 *
 * Simkl clamps an out-of-range `limit` or `page` silently rather than erroring,
 * and `/lists/{id}` is edge-cached in a way that makes even a malformed `limit`
 * come back 200, so the window is enforced here instead of being left to the
 * server: stop at `MAX_WINDOW` items, at the reported `total_pages`, or at the
 * first short page, whichever comes first.
 */
async function collectPages<TPage, TItem>(
	readPage: (page: number) => Promise<TPage>,
	itemsOf: (page: TPage) => TItem[] | undefined,
	totalPagesOf: (page: TPage) => number | undefined
): Promise<{ items: TItem[]; first: TPage }> {
	const first = await readPage(1);
	const items = [...(itemsOf(first) ?? [])];
	const totalPages = totalPagesOf(first) ?? 1;
	const lastPage = Math.min(totalPages, Math.floor(MAX_WINDOW / PAGE_SIZE));

	for (let page = 2; page <= lastPage; page++) {
		const next = await readPage(page);
		const batch = itemsOf(next) ?? [];
		items.push(...batch);
		if (batch.length < PAGE_SIZE) break;
	}
	return { items, first };
}

interface SimklPagination {
	page: number;
	limit: number;
	total_items: number;
	total_pages: number;
}

/** Every custom list the user owns, follows or collaborates on. */
export async function getSimklUserLists(
	token: string,
	userId: number,
	fetcher: Fetcher = fetch
): Promise<SimklListSummary[]> {
	const { items } = await collectPages<
		{ pagination?: SimklPagination; lists?: SimklListSummary[] },
		SimklListSummary
	>(
		(page) =>
			simklGet(
				`/lists/user/${userId}`,
				token,
				{ page: String(page), limit: String(PAGE_SIZE), sort: 'updated' },
				fetcher
			),
		(body) => body.lists,
		(body) => body.pagination?.total_pages
	);
	return items;
}

/** One list's metadata plus every item in it, in the owner's chosen order. */
export async function getSimklList(
	token: string,
	listId: number,
	fetcher: Fetcher = fetch
): Promise<SimklList> {
	const { items, first } = await collectPages<
		SimklListSummary & { pagination?: SimklPagination; items?: SimklListItem[] },
		SimklListItem
	>(
		(page) =>
			simklGet(
				`/lists/${listId}`,
				token,
				{ page: String(page), limit: String(PAGE_SIZE) },
				fetcher
			),
		(body) => body.items,
		(body) => body.pagination?.total_pages
	);
	const { pagination: _pagination, items: _items, ...metadata } = first;
	return { ...metadata, items };
}

/**
 * The DMM route a list item points at.
 *
 * Every DMM media surface is keyed by IMDb id, so an item without one has no
 * page to link to and the caller drops it. Simkl's `type` is `movie`, `tv` or
 * `anime`; DMM has two routes, and anime lives under `/show` with everything
 * else episodic.
 */
export function simklItemHref(item: SimklListItem): string | null {
	const imdbId = item.ids?.imdb;
	if (!imdbId || !/^tt\d+$/.test(imdbId)) return null;
	return item.type === 'movie' ? `/movie/${imdbId}` : `/show/${imdbId}`;
}

export const _testing = { APP_NAME, APP_VERSION, PAGE_SIZE, MAX_WINDOW, base64url };
