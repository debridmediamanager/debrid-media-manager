/**
 * Premiumize OAuth 2.0 device-code login.
 *
 * Device code rather than Authorization Code with PKCE, because DMM is
 * self-hostable: PKCE binds to a single registered `redirect_uri`, so every
 * localhost and self-hosted instance would either break or have to share one
 * callback host. The device flow needs no redirect at all - the user reads a
 * short code off the screen and approves it on any device - so it behaves
 * identically wherever DMM runs.
 *
 * Two measured facts shape the rest of this (2026-08-23, against a registered
 * client):
 *
 *  - **The token lasts 10 years.** `expires_in` comes back as 315,360,000
 *    seconds. That is why Premiumize documents no refresh token and offers no
 *    `grant_type=refresh_token`: there is nothing to refresh. Nothing here
 *    schedules a renewal, and nothing should - see the `rd:accessToken` 24h
 *    expiry in AGENTS.md for what the alternative costs.
 *  - **`token_type` is the string `"bearer"`, lowercase, and Premiumize's own
 *    API rejects lowercase `bearer` in the `Authorization` header.** A client
 *    that does the RFC-correct thing and echoes `token_type` back gets
 *    `authentication_failed`. The scheme is hardcoded; `token_type` is ignored.
 *
 * These endpoints live at `/token`, not under `/api/`, and answer with real HTTP
 * status codes and `error` / `error_description` - a completely different
 * contract from the API's HTTP-200 `{"status":"error","code":...}`. They also
 * send no `access-control-allow-origin` at all, so a browser cannot read the
 * response cross-origin: this goes through DMM's own server, always.
 */

const PM_OAUTH_PROXY = '/api/premiumize-oauth';

export interface PremiumizeDeviceCode {
	/** Where the user goes to type the code, e.g. https://www.premiumize.me/device */
	verification_uri: string;
	/** Short code shown to the user, `xxxx-xxxx`. Case-insensitive, dash optional. */
	user_code: string;
	/** Opaque handle DMM polls with. Never shown to the user. */
	device_code: string;
	/** Seconds the user has to approve - 600 at time of writing. */
	expires_in: number;
	/** Seconds between polls. Premiumize answers `slow_down` if you go faster. */
	interval: number;
}

export interface PremiumizeTokenResponse {
	access_token: string;
	/** Literally `"bearer"`, lowercase. Do not put this in a header. */
	token_type: string;
	/** Seconds. Measured at 315,360,000 - ten years. */
	expires_in: number;
	scope: string;
}

/** The OAuth endpoints' own error shape, which is not the API's error shape. */
export interface PremiumizeOAuthErrorBody {
	error: string;
	error_description?: string;
}

export class PremiumizeOAuthError extends Error {
	readonly error: string;

	constructor(error: string, description?: string) {
		super(description || error);
		this.name = 'PremiumizeOAuthError';
		this.error = error;
	}
}

/** Polling outcomes that mean "keep going" rather than "give up". */
const PENDING = 'authorization_pending';
const SLOW_DOWN = 'slow_down';

const postJson = async <T>(action: string, body: Record<string, unknown> = {}): Promise<T> => {
	const response = await fetch(`${PM_OAUTH_PROXY}/${action}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	const data = await response.json().catch(() => ({
		error: 'non_json_response',
		error_description: `Premiumize answered ${response.status}`,
	}));
	if (!response.ok || data?.error) {
		throw new PremiumizeOAuthError(data?.error || 'unknown_error', data?.error_description);
	}
	return data as T;
};

export const requestPremiumizeDeviceCode = (): Promise<PremiumizeDeviceCode> =>
	postJson<PremiumizeDeviceCode>('device');

/**
 * One poll. Resolves with the token when the user has approved, or `null` while
 * the request is still pending; throws once the outcome is terminal.
 *
 * `slow_down` is reported through `onSlowDown` rather than swallowed, because
 * the caller owns the interval and Premiumize expects it to grow.
 */
export async function pollPremiumizeDeviceToken(
	deviceCode: string,
	onSlowDown?: () => void
): Promise<PremiumizeTokenResponse | null> {
	try {
		return await postJson<PremiumizeTokenResponse>('token', { device_code: deviceCode });
	} catch (error) {
		if (error instanceof PremiumizeOAuthError) {
			if (error.error === PENDING) return null;
			if (error.error === SLOW_DOWN) {
				onSlowDown?.();
				return null;
			}
		}
		throw error;
	}
}

export const _testing = { PENDING, SLOW_DOWN, PM_OAUTH_PROXY };
