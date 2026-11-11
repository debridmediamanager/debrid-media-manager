import type { ParseOptions, Type } from '@badrap/valita';
import type { SimklList, SimklListItem, SimklListSummary, SimklUser } from './simkl';
import { SimklError } from './simkl';
import {
	simklListPageSchema,
	simklProviderErrorSchema,
	simklProviderUserSchema,
	simklRevokeSchema,
	simklTokensSchema,
	simklUserListsPageSchema,
} from './simklSchemas';

export interface SimklTokens {
	access_token: string;
	token_type: string;
	expires_in: number;
	refresh_token?: string;
	scope?: string;
}
const SIMKL_API_URL = 'https://api.simkl.com';
const SIMKL_TOKEN_URL = SIMKL_API_URL + '/oauth2/token';
const APP_NAME = 'debridmediamanager';
const APP_VERSION = '4.0';
const MAX_WINDOW = 10000;
const PAGE_SIZE = 500;
type Fetcher = typeof fetch;
export const getSimklProviderClientId = () =>
	process.env.SIMKL_V2_CLIENT_ID ||
	'ee604693523d56749368fc703b2467b60a2ee2531af258f689c8b9666a5d3c5b';

// Bound the whole response (including its body), shorter than the refresh lock.
async function request<T>(
	url: string,
	init: RequestInit,
	fetcher: Fetcher,
	schema: Type<T>,
	invalidCode = 'invalid_provider_response',
	mode: ParseOptions['mode'] = 'passthrough'
): Promise<T> {
	const controller = new AbortController();
	const timeout = Promise.withResolvers<never>();
	const timer = setTimeout(() => {
		controller.abort();
		timeout.reject(new SimklError('upstream_timeout', 'Simkl request timed out', 504));
	}, 10_000);
	try {
		return await Promise.race([
			fetcher(url, { ...init, signal: controller.signal }).then((response) =>
				readSimklBody(response, schema, invalidCode, mode)
			),
			timeout.promise,
		]);
	} catch (error) {
		if (error instanceof SimklError) throw error;
		throw new SimklError('upstream_unavailable', 'Simkl is temporarily unavailable', 502);
	} finally {
		clearTimeout(timer);
	}
}

async function readSimklBody<T>(
	response: Response,
	schema: Type<T>,
	invalidCode: string,
	mode: ParseOptions['mode']
): Promise<T> {
	const text = await response.text();
	let body: unknown;
	try {
		body = text ? JSON.parse(text) : {};
	} catch {
		throw new SimklError(
			'non_json_response',
			`Simkl answered ${response.status} with a non-JSON body`,
			response.status
		);
	}

	if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
		const envelope = simklProviderErrorSchema.parse(body, { mode: 'passthrough' });
		throw new SimklError(
			envelope.error,
			envelope.message || envelope.error_description || envelope.error,
			envelope.code ?? response.status
		);
	}
	if (!response.ok) {
		throw new SimklError('http_error', `Simkl answered ${response.status}`, response.status);
	}
	try {
		return schema.parse(body, { mode });
	} catch {
		throw new SimklError(invalidCode, 'Simkl returned an invalid response', 502);
	}
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
	params: Record<string, string>,
	fetcher: Fetcher,
	schema: Type<T>
): Promise<T> {
	const clientId = getSimklProviderClientId();
	return request<T>(
		withAppParams(path, clientId, params),
		{
			headers: { Authorization: `Bearer ${token}` },
		},
		fetcher,
		schema
	);
}

async function simklTokenRequest(
	body: Record<string, string>,
	fetcher: Fetcher = fetch
): Promise<SimklTokens> {
	const clientId = getSimklProviderClientId();
	const tokens = await request<SimklTokens>(
		SIMKL_TOKEN_URL,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ ...body, client_id: clientId }).toString(),
		},
		fetcher,
		simklTokensSchema,
		'invalid_token_response',
		'strip'
	);
	return tokens;
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
	simklGet('/users/settings', token, {}, fetcher, simklProviderUserSchema);

/**
 * Walks a paginated endpoint to the end.
 *
 * Simkl clamps an out-of-range `limit` or `page` silently rather than erroring,
 * and `/lists/{id}` is edge-cached in a way that makes even a malformed `limit`
 * come back 200, so the window is enforced here instead of being left to the
 * server. The pagination block is authoritative: sparse pages can still have
 * subsequent pages. Never infer the end from the number of returned items.
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
				{
					page: String(page),
					limit: String(PAGE_SIZE),
					sort: 'updated',
					followed: 'true',
					collaborants: 'true',
				},
				fetcher,
				simklUserListsPageSchema
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
				fetcher,
				simklListPageSchema
			),
		(body) => body.items,
		(body) => body.pagination?.total_pages
	);
	const { pagination: _pagination, items: _items, ...metadata } = first;
	return { ...metadata, items };
}

export async function revokeSimklToken(token: string, fetcher: Fetcher = fetch): Promise<void> {
	await request(
		'https://api.simkl.com/oauth2/revoke',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ client_id: getSimklProviderClientId(), token }).toString(),
		},
		fetcher,
		simklRevokeSchema
	);
}
