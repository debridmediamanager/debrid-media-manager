import * as v from '@badrap/valita';
import type { SimklUser } from './simkl';
import { SIMKL_REDIRECT_PATH, SimklError } from './simkl';
import {
	exchangeSimklCode,
	getSimklList,
	getSimklUser,
	getSimklUserLists,
	revokeSimklToken,
} from './simklProvider';
import { simklUserSchema } from './simklSchemas';
import type { SimklSessionStore } from './simklSession';
import {
	createSimklSessionId,
	getSimklSessionStore,
	makeSimklSession,
	SIMKL_SESSION_COOKIE,
	SIMKL_SESSION_SECONDS,
	withSimklSession,
} from './simklSession';

export interface SimklProxyRequest {
	method?: string;
	route: string[];
	body?: unknown;
	headers: Record<string, string | string[] | undefined>;
	env?: NodeJS.ProcessEnv;
}
export interface SimklProxyResult {
	httpStatus: number;
	body: unknown;
	headers: Record<string, string>;
}

const exchangeBodySchema = v.object({
	code: v.string().assert((value) => value.length > 0 && value.length <= 4096),
	codeVerifier: v.string().assert((value) => /^[A-Za-z0-9._~-]{43,128}$/.test(value)),
	redirectUri: v.string(),
});

function readExchangeBody(raw: unknown, origin: string) {
	try {
		const body = exchangeBodySchema.parse(raw);
		if (body.redirectUri !== origin + SIMKL_REDIRECT_PATH) throw new Error();
		return body;
	} catch {
		throw new SimklError('invalid_request', 'Invalid Simkl authorization exchange', 400);
	}
}

// Unknown upstream codes are untrusted data, not safe browser-facing symbols.
const publicErrorMessages: Readonly<Record<string, string>> = {
	signed_out: 'Sign in to Simkl',
	user_token_required: 'Sign in to Simkl',
	invalid_grant: 'Sign in to Simkl',
	premium_only: 'Simkl Custom Lists require PRO or VIP',
	private_list: 'This Simkl list is private',
	oauth2_token_required: 'Simkl sign-in requires AUTH V2',
	invalid_client: 'Simkl sign-in is not configured correctly',
	forbidden_origin: 'Same-origin requests only',
	method_not_allowed: 'Use the supported HTTP method',
	invalid_request: 'Invalid Simkl request',
	not_found: 'Unknown Simkl route',
	not_configured: 'Invalid Simkl origin configuration',
	session_unavailable: 'Simkl sessions are temporarily unavailable',
	upstream_timeout: 'Simkl request timed out',
	upstream_unavailable: 'Simkl is temporarily unavailable',
	invalid_token_response: 'Simkl returned invalid credentials',
	invalid_provider_response: 'Simkl returned an invalid response',
	non_json_response: 'Simkl returned an invalid response',
	http_error: 'Simkl request could not be completed',
	upstream_error: 'Simkl request could not be completed',
};
function approvedOrigin(req: SimklProxyRequest): string {
	const env = req.env || process.env;
	if (env.DMM_ORIGIN) {
		try {
			const url = new URL(env.DMM_ORIGIN);
			if (
				!['http:', 'https:'].includes(url.protocol) ||
				url.username ||
				url.password ||
				url.pathname !== '/' ||
				url.search ||
				url.hash
			)
				throw new Error();
			return url.origin;
		} catch {
			throw new SimklError('not_configured', 'Invalid DMM origin configuration', 503);
		}
	}
	const host = req.headers.host;
	// Host is not a trust anchor for arbitrary public deployments. Self-hosted
	// instances configure DMM_ORIGIN; only local development has a host fallback.
	if (
		env.NODE_ENV !== 'production' &&
		typeof host === 'string' &&
		/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host)
	)
		return `http://${host}`;
	return 'https://debridmediamanager.com';
}
function sessionCookie(id: string, origin: string): string {
	return `${SIMKL_SESSION_COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${id ? SIMKL_SESSION_SECONDS : 0}${origin.startsWith('https:') ? '; Secure' : ''}`;
}
function sessionId(headers: SimklProxyRequest['headers']): string | undefined {
	const cookie = headers.cookie;
	if (typeof cookie !== 'string') return undefined;
	const matches = cookie
		.split(';')
		.map((part) => part.trim())
		.filter((part) => part.startsWith(`${SIMKL_SESSION_COOKIE}=`));
	if (matches.length !== 1) return undefined;
	const id = matches[0].slice(SIMKL_SESSION_COOKIE.length + 1);
	return /^[A-Za-z0-9_-]{43}$/.test(id) ? id : undefined;
}
// Never forward the provider account object wholesale: future provider fields
// could otherwise expose credentials through an innocent account read.
function publicUser(profile: SimklUser): SimklUser {
	return simklUserSchema.parse(profile, { mode: 'strip' });
}
export async function handleSimklRequest(
	req: SimklProxyRequest,
	injectedStore?: SimklSessionStore
): Promise<SimklProxyResult> {
	const headers: Record<string, string> = {
		'Cache-Control': 'private, no-store',
		Vary: 'Cookie',
	};
	try {
		const action = req.route[0];
		const isList =
			action === 'list' &&
			req.route.length === 2 &&
			/^[1-9]\d*$/.test(req.route[1]) &&
			Number.isSafeInteger(Number(req.route[1]));
		if (
			!isList &&
			!(req.route.length === 1 && ['exchange', 'account', 'lists', 'logout'].includes(action))
		)
			throw new SimklError('not_found', 'Unknown Simkl route', 404);
		const method = action === 'exchange' || action === 'logout' ? 'POST' : 'GET';
		if (req.method !== method) {
			headers.Allow = method;
			throw new SimklError('method_not_allowed', `Use ${method}`, 405);
		}
		const origin = approvedOrigin(req);
		if (method === 'POST') {
			if (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site')
				throw new SimklError('forbidden_origin', 'Same-origin requests only', 403);
		}
		const id = sessionId(req.headers);
		if (action === 'logout') headers['Set-Cookie'] = sessionCookie('', origin);
		const store = injectedStore || getSimklSessionStore();
		if (action === 'exchange') {
			const tokens = await exchangeSimklCode(readExchangeBody(req.body, origin));
			let newId: string;
			try {
				const user = publicUser(await getSimklUser(tokens.access_token));
				newId = createSimklSessionId();
				await store.create(newId, makeSimklSession(tokens, user));
			} catch (error) {
				await revokeSimklToken(tokens.refresh_token || tokens.access_token).catch(() => {});
				throw error;
			}
			if (id) {
				try {
					const previous = await store.remove(id);
					if (previous)
						await revokeSimklToken(
							previous.tokens.refresh_token || previous.tokens.access_token
						).catch(() => {});
				} catch (error) {
					await store.remove(newId).catch(() => {});
					await revokeSimklToken(tokens.refresh_token || tokens.access_token).catch(
						() => {}
					);
					throw error;
				}
			}
			headers['Set-Cookie'] = sessionCookie(newId, origin);
			return { httpStatus: 200, body: { ok: true }, headers };
		}
		if (action === 'logout') {
			const previous = id ? await store.remove(id) : null;
			if (previous)
				await revokeSimklToken(
					previous.tokens.refresh_token || previous.tokens.access_token
				).catch(() => {});
			return { httpStatus: 200, body: { ok: true }, headers };
		}
		const body = await withSimklSession(id, store, async (session) => {
			if (action === 'account')
				return {
					user: publicUser(await getSimklUser(session.tokens.access_token)),
					cacheKey: session.cacheKey,
					expiresAt: session.expiresAt,
				};
			if (action === 'lists')
				return getSimklUserLists(session.tokens.access_token, session.user.account.id);
			return getSimklList(session.tokens.access_token, Number(req.route[1]));
		});
		// Renew the opaque browser capability alongside the sliding grant.
		headers['Set-Cookie'] = sessionCookie(id!, origin);
		return { httpStatus: 200, body, headers };
	} catch (error) {
		const known = error instanceof SimklError;
		const status = known
			? error.isUnauthorized
				? 401
				: error.status >= 400 && error.status <= 599
					? error.status
					: 400
			: 503;
		const code =
			known && Object.hasOwn(publicErrorMessages, error.code)
				? error.code
				: known
					? 'upstream_error'
					: 'session_unavailable';
		return {
			httpStatus: status,
			body: {
				error: code,
				// Upstream descriptions can echo credential input. Never return them.
				message: publicErrorMessages[code],
				status,
			},
			headers,
		};
	}
}
