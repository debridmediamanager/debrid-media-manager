import type { PremiumizeOAuthErrorBody } from './premiumizeOAuth';

/**
 * Server side of Premiumize's device-code login, kept out of `pages/` so it can
 * be tested - anything under `pages/` is a route, test files included.
 *
 * This exists as a proxy for two reasons, not one:
 *
 *  - **The browser cannot read `/token` cross-origin.** It sends no
 *    `access-control-allow-origin` header at all, so the response is opaque to
 *    a browser even though the request itself would be a simple one.
 *  - **The `client_id` is server-owned.** It is not a secret, but taking it from
 *    the request body would let a caller mint device codes against somebody
 *    else's registered application through DMM.
 *
 * The `client_secret` is deliberately absent: the device flow does not use one,
 * and a secret shipped in a self-hostable app is not a secret.
 */

const PM_TOKEN_ENDPOINT = 'https://www.premiumize.me/token';
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Fallback is the client registered for debridmediamanager.com. Override with
 * `PREMIUMIZE_CLIENT_ID` so a self-hosted or staging instance can point at its
 * own registration without a code change.
 */
export const getPremiumizeClientId = (env: NodeJS.ProcessEnv = process.env): string =>
	env.PREMIUMIZE_CLIENT_ID || '713833636';

export type OAuthAction = 'device' | 'token';

export const isOAuthAction = (value: unknown): value is OAuthAction =>
	value === 'device' || value === 'token';

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

const oauthError = (error: string, description: string): PremiumizeOAuthErrorBody => ({
	error,
	error_description: description,
});

async function callTokenEndpoint(
	params: Record<string, string>
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const upstream = await fetch(PM_TOKEN_ENDPOINT, {
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
					`Premiumize answered ${upstream.status} with ${contentType || 'no content type'}`
				) as unknown as Record<string, unknown>,
			};
		}

		// The OAuth endpoints use real HTTP status codes, unlike /api/* which
		// answers 200 for business errors. Pass the status through as-is: the
		// poll loop distinguishes authorization_pending from a hard failure by
		// the `error` string, and both arrive as 400.
		return { httpStatus: upstream.status, body: await upstream.json() };
	} finally {
		clearTimeout(timer);
	}
}

export async function handlePremiumizeOAuthRequest(
	req: OAuthProxyRequest
): Promise<OAuthProxyResult> {
	if (req.method !== 'POST') {
		return {
			httpStatus: 405,
			body: oauthError('invalid_request', 'Use POST.') as unknown as Record<string, unknown>,
			allowHeader: 'POST',
		};
	}

	if (!isOAuthAction(req.action)) {
		return {
			httpStatus: 404,
			body: oauthError(
				'invalid_request',
				`Unknown action: ${req.action}`
			) as unknown as Record<string, unknown>,
		};
	}

	const clientId = getPremiumizeClientId(req.env);
	const params =
		req.body && typeof req.body === 'object' && !Array.isArray(req.body)
			? (req.body as Record<string, unknown>)
			: {};

	try {
		if (req.action === 'device') {
			return await callTokenEndpoint({
				response_type: 'device_code',
				client_id: clientId,
			});
		}

		const deviceCode = params.device_code;
		if (typeof deviceCode !== 'string' || !deviceCode) {
			return {
				httpStatus: 400,
				body: oauthError('invalid_request', 'device_code is required') as unknown as Record<
					string,
					unknown
				>,
			};
		}
		return await callTokenEndpoint({
			grant_type: 'device_code',
			code: deviceCode,
			client_id: clientId,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return {
			httpStatus: 502,
			body: oauthError('temporarily_unavailable', message) as unknown as Record<
				string,
				unknown
			>,
		};
	}
}
