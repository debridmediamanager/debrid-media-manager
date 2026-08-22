import {
	callPremiumizeDirect,
	resolvePremiumizeTransferHashesDirect,
	type PremiumizeEnvelope,
} from './premiumize';

/**
 * Request handling for `/api/premiumize/*`, kept out of `pages/` so it can be
 * tested - anything under `pages/` is a route, test files included.
 *
 * Two Premiumize properties drive the shape of this:
 *
 *  - **The router ignores the HTTP method.** `GET /api/transfer/delete?id=...`
 *    really deletes a user's files. Only POST is accepted here and only
 *    allow-listed endpoints are forwarded, so a stray prefetch, a link in a log
 *    or a Referer header cannot destroy a cloud.
 *  - **The key must never reach a URL.** Premiumize's own advice is to keep it
 *    out of logs and Referer headers, and its CORS preflight approves no headers,
 *    so the browser cannot follow that advice on its own. This proxy is how it
 *    gets followed: header in, header out.
 */

/** Every endpoint DMM may reach. `folder/paste`, `feed/*` and uploads are deliberately absent. */
export const ALLOWED_ENDPOINTS = [
	'account/info',
	'cache/check',
	'folder/delete',
	'folder/list',
	'item/delete',
	'item/details',
	'item/listall',
	'transfer/clearfinished',
	'transfer/create',
	'transfer/delete',
	'transfer/directdl',
	'transfer/list',
] as const;

const ALLOWED = new Set<string>(ALLOWED_ENDPOINTS);

/** Virtual endpoint: resolves transfer ids to info hashes via `job/src`. */
export const HASHES_ENDPOINT = 'transfer/hashes';

export const errorEnvelope = (code: string, message: string): PremiumizeEnvelope => ({
	status: 'error',
	code,
	message,
});

export const isAllowedEndpoint = (endpoint: string): boolean =>
	endpoint === HASHES_ENDPOINT || ALLOWED.has(endpoint);

export const joinEndpoint = (segments: string | string[] | undefined): string =>
	(Array.isArray(segments) ? segments : [segments])
		.filter((segment): segment is string => typeof segment === 'string')
		.join('/');

/** `Bearer <key>`, capital B and a single space - Premiumize itself rejects `bearer`. */
export const readApiKey = (header: string | string[] | undefined): string | null => {
	if (typeof header !== 'string') return null;
	const match = /^Bearer\s+(\S+)$/.exec(header.trim());
	return match ? match[1] : null;
};

export interface ProxyRequest {
	method?: string;
	endpoint: string;
	authorization?: string | string[];
	body?: unknown;
}

export interface ProxyResult {
	httpStatus: number;
	body: PremiumizeEnvelope;
	allowHeader?: string;
}

export async function handlePremiumizeProxyRequest(req: ProxyRequest): Promise<ProxyResult> {
	if (req.method !== 'POST') {
		return {
			httpStatus: 405,
			body: errorEnvelope('method_not_allowed', 'Use POST.'),
			allowHeader: 'POST',
		};
	}

	if (!isAllowedEndpoint(req.endpoint)) {
		return {
			httpStatus: 404,
			body: errorEnvelope('not_found', `Unknown endpoint: ${req.endpoint}`),
		};
	}

	const apiKey = readApiKey(req.authorization);
	if (!apiKey) {
		return {
			httpStatus: 401,
			body: errorEnvelope('authentication_failed', 'Missing Premiumize API key.'),
		};
	}

	const params =
		req.body && typeof req.body === 'object' && !Array.isArray(req.body)
			? (req.body as Record<string, unknown>)
			: {};

	try {
		if (req.endpoint === HASHES_ENDPOINT) {
			const ids = Array.isArray(params.ids)
				? params.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
				: [];
			const hashes = await resolvePremiumizeTransferHashesDirect(apiKey, ids);
			return { httpStatus: 200, body: { status: 'success', hashes } };
		}

		return await callPremiumizeDirect(apiKey, req.endpoint, params);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return { httpStatus: 502, body: errorEnvelope('transient_error', message) };
	}
}
