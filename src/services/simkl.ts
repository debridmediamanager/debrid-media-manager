import getConfig from 'next/config';
import {
	simklApiErrorSchema,
	simklListSchema,
	simklListsSchema,
	simklOkSchema,
	simklPublicSessionSchema,
} from './simklSchemas';

/** Shared SIMKL shapes and the browser's same-origin session API. Credentials stay server-side. */
export const SIMKL_AUTHORIZE_URL = 'https://simkl.com/oauth2/authorize';

/**
 * The path Simkl redirects back to. It is registered against the client id, so
 * it is a constant rather than a setting - an instance serving DMM from another
 * origin needs its own V2 client id with its own redirect registered.
 */
export const SIMKL_REDIRECT_PATH = '/auth/simkl';

/** Read-only is all the Custom Lists API offers today; writes are web-only. */
export const SIMKL_SCOPE = 'media:read';

/**
 * Read at call time, not at import time. Destructuring `getConfig()` in module
 * scope - which `services/trakt.ts` does - throws outright wherever there is no
 * Next runtime to answer it, which takes the whole module down with it.
 */
export const getSimklClientId = (): string | null =>
	getConfig()?.publicRuntimeConfig?.simklClientId || null;

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
	/** Anime format from CustomListItem, e.g. `movie`, `tv`, `ova`. */
	anime_type?: string;
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

	/** The backend session is missing, expired or revoked. */
	get isUnauthorized(): boolean {
		return this.status === 401 || this.code === SIMKL_TOKEN_REQUIRED;
	}
}

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

export interface SimklSession {
	user: SimklUser;
	/** Random, non-credential namespace for private browser caches. */
	cacheKey: string;
	expiresAt: number;
}

async function simklSessionRequest<T>(
	path: string,
	parse: (value: unknown) => T,
	body?: object
): Promise<T> {
	const response = await fetch(`/api/simkl/${path}`, {
		method: body ? 'POST' : 'GET',
		credentials: 'same-origin',
		cache: 'no-store',
		...(body
			? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
			: {}),
	});
	let result: unknown;
	try {
		result = await response.json();
	} catch {
		throw new SimklError(
			'non_json_response',
			'SIMKL session service returned an invalid response',
			response.status
		);
	}
	const failure = simklApiErrorSchema.try(result, { mode: 'strip' });
	if (!response.ok || failure.ok) {
		throw new SimklError(
			failure.ok ? failure.value.error : 'http_error',
			failure.ok
				? failure.value.message
				: `SIMKL session service answered ${response.status}`,
			failure.ok ? failure.value.status : response.status
		);
	}
	try {
		return parse(result);
	} catch {
		throw new SimklError(
			'invalid_response',
			'SIMKL session service returned an invalid response',
			response.status
		);
	}
}

export async function exchangeSimklCode(params: {
	code: string;
	codeVerifier: string;
	redirectUri: string;
}): Promise<void> {
	await simklSessionRequest(
		'exchange',
		(value) => simklOkSchema.parse(value, { mode: 'strip' }),
		params
	);
}
export const getSimklSession = (): Promise<SimklSession> =>
	simklSessionRequest('account', (value) =>
		simklPublicSessionSchema.parse(value, { mode: 'strip' })
	);
export const getSimklUserLists = (): Promise<SimklListSummary[]> =>
	simklSessionRequest('lists', (value) => simklListsSchema.parse(value, { mode: 'passthrough' }));
export const getSimklList = (listId: number): Promise<SimklList> =>
	simklSessionRequest(`list/${listId}`, (value) =>
		simklListSchema.parse(value, { mode: 'passthrough' })
	);
export async function logoutSimkl(): Promise<void> {
	await simklSessionRequest(
		'logout',
		(value) => simklOkSchema.parse(value, { mode: 'strip' }),
		{}
	);
}

/**
 * The DMM route a list item points at.
 *
 * Every DMM media surface is keyed by IMDb id, so an item without one has no
 * page to link to and the caller drops it. Anime's catalog type stays `anime`
 * even for films; its `anime_type` discriminator decides movie versus series.
 */
export function simklItemHref(item: SimklListItem): string | null {
	const imdbId = item.ids?.imdb;
	if (!imdbId || !/^tt\d+$/.test(imdbId)) return null;
	return item.type === 'movie' || (item.type === 'anime' && item.anime_type === 'movie')
		? `/movie/${imdbId}`
		: `/show/${imdbId}`;
}
