import type { DebridLinkOAuthErrorBody } from './debridLinkOAuth';

/**
 * Server side of Debrid-Link's device-code login, kept out of `pages/` so it can
 * be tested - anything under `pages/` is a route, test files included.
 *
 * It exists for the same reason Premiumize's does, minus one: the **`client_id`
 * is server-owned**. It is not a secret, but taking it from the request body
 * would let a caller mint device codes against somebody else's registered
 * application through DMM. (Debrid-Link's CORS is wide open, so unlike
 * Premiumize the browser *could* reach these endpoints directly - it still does
 * not, because of the client id.)
 *
 * No `client_secret` is used or shipped: the device flow does not need one, and
 * a secret in a self-hostable app is not a secret.
 *
 * Three details are load-bearing and none of them are guesses:
 *
 *  - **These endpoints are NOT under `/api/v2`.** They live at `/api/oauth/*`,
 *    beside the versioned API rather than inside it.
 *  - **The device grant type is the full URN** `http://oauth.net/grant_type/device/1.0`,
 *    not the RFC 8628 spelling `urn:ietf:params:oauth:grant-type:device_code`.
 *  - **The scopes are requested explicitly.** The documented defaults drop the
 *    `delete` grants, and DMM deletes torrents - a default-scoped token would
 *    sign in fine and then fail at the one operation the user cannot retry
 *    their way out of.
 */

const DL_DEVICE_ENDPOINT = 'https://debrid-link.fr/api/oauth/device/code';
const DL_TOKEN_ENDPOINT = 'https://debrid-link.fr/api/oauth/token';
const REQUEST_TIMEOUT_MS = 20_000;

/** The vendor's own spelling; the RFC 8628 URN is not what this API accepts. */
export const DEVICE_GRANT_TYPE = 'http://oauth.net/grant_type/device/1.0';

/**
 * Space-delimited, and deliberately more than the defaults: `get.account` for
 * the profile, `get.post.delete.seedbox` because DMM adds *and removes*
 * torrents, `get.files` for the filemanager view and `get.post.stream` for the
 * transcode surface.
 */
export const DEBRIDLINK_SCOPES = 'get.account get.post.delete.seedbox get.files get.post.stream';

/**
 * Fallback is plex_debrid's public client, which is what this integration was
 * built against. Override with `DEBRIDLINK_CLIENT_ID` so a self-hosted or
 * staging instance can point at its own registration without a code change.
 */
export const getDebridLinkClientId = (env: NodeJS.ProcessEnv = process.env): string =>
	env.DEBRIDLINK_CLIENT_ID || '0KLCzpbPTCsWZtQ9Ad0aZA';

export type DebridLinkOAuthAction = 'device' | 'token' | 'refresh';

export const isDebridLinkOAuthAction = (value: unknown): value is DebridLinkOAuthAction =>
	value === 'device' || value === 'token' || value === 'refresh';

export interface OAuthProxyRequest {
	method?: string;
	action: string;
	body?: unknown;
	env?: NodeJS.ProcessEnv;
}

export interface OAuthProxyResult {
	httpStatus: number;
	body: Record<string, unknown>;
	allowHeader?: string;
}

const oauthError = (error: string, description: string): Record<string, unknown> => {
	const body: DebridLinkOAuthErrorBody = { error, error_description: description };
	return body as unknown as Record<string, unknown>;
};

async function callOAuthEndpoint(
	endpoint: string,
	params: Record<string, string>
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const upstream = await fetch(endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams(params).toString(),
			signal: controller.signal,
		});

		const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
		if (!contentType.includes('application/json')) {
			return {
				httpStatus: 502,
				body: oauthError(
					'non_json_response',
					`Debrid-Link answered ${upstream.status} with ${contentType || 'no content type'}`
				),
			};
		}

		// The OAuth endpoints use real HTTP status codes, and both
		// `authorization_pending` and a hard failure arrive as 400 - only the
		// `error` string separates them, so the status is passed through as-is
		// rather than flattened.
		return { httpStatus: upstream.status, body: await upstream.json() };
	} finally {
		clearTimeout(timer);
	}
}

export async function handleDebridLinkOAuthRequest(
	req: OAuthProxyRequest
): Promise<OAuthProxyResult> {
	if (req.method !== 'POST') {
		return {
			httpStatus: 405,
			body: oauthError('invalid_request', 'Use POST.'),
			allowHeader: 'POST',
		};
	}

	if (!isDebridLinkOAuthAction(req.action)) {
		return {
			httpStatus: 404,
			body: oauthError('invalid_request', `Unknown action: ${req.action}`),
		};
	}

	const clientId = getDebridLinkClientId(req.env);
	const params =
		req.body && typeof req.body === 'object' && !Array.isArray(req.body)
			? (req.body as Record<string, unknown>)
			: {};

	try {
		if (req.action === 'device') {
			return await callOAuthEndpoint(DL_DEVICE_ENDPOINT, {
				client_id: clientId,
				scope: DEBRIDLINK_SCOPES,
			});
		}

		if (req.action === 'refresh') {
			const refreshToken = params.refresh_token;
			if (typeof refreshToken !== 'string' || !refreshToken) {
				return {
					httpStatus: 400,
					body: oauthError('invalid_request', 'refresh_token is required'),
				};
			}
			return await callOAuthEndpoint(DL_TOKEN_ENDPOINT, {
				client_id: clientId,
				refresh_token: refreshToken,
				grant_type: 'refresh_token',
			});
		}

		const deviceCode = params.device_code;
		if (typeof deviceCode !== 'string' || !deviceCode) {
			return {
				httpStatus: 400,
				body: oauthError('invalid_request', 'device_code is required'),
			};
		}
		return await callOAuthEndpoint(DL_TOKEN_ENDPOINT, {
			client_id: clientId,
			code: deviceCode,
			grant_type: DEVICE_GRANT_TYPE,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return { httpStatus: 502, body: oauthError('temporarily_unavailable', message) };
	}
}
