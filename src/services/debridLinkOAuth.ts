/**
 * Debrid-Link OAuth 2.0 device-code login.
 *
 * Device code rather than Authorization Code with PKCE, for the same reason
 * Premiumize's login uses it: DMM is self-hostable, PKCE binds to a single
 * registered `redirect_uri`, and the device flow needs no redirect at all - so
 * it behaves identically on localhost, on a self-hosted instance and in
 * production.
 *
 * Everything server-owned lives in `debridLinkOAuthProxy` - the `client_id`,
 * the scope list and the two upstream endpoints. This half is only the browser's
 * side of the conversation.
 *
 * **Token lifetime is not yet measured.** plex_debrid mints a token, never
 * refreshes it and keeps working, which suggests a long life, but that is an
 * inference and not a measurement - unlike Premiumize, where `expires_in` was
 * read back as ten years and the refresh machinery was deliberately left out.
 * Debrid-Link does document a refresh token ("For Oauth2, you should try to
 * refresh the access_token if you have a refresh_token"), so the refresh path
 * exists here and the caller stores an absolute expiry when one is offered. If
 * an E2E mint shows a ten-year `expires_in`, delete the refresh path rather than
 * carrying dead machinery; if it shows days, keep it.
 */

const DL_OAUTH_PROXY = '/api/debridlink-oauth';

export interface DebridLinkDeviceCode {
	/** Opaque handle DMM polls with. Never shown to the user. */
	device_code: string;
	/** Short code the user types on Debrid-Link. */
	user_code: string;
	/** Seconds the user has to approve. */
	expires_in: number;
	/** Seconds between polls. Debrid-Link answers `slow_down` if you go faster. */
	interval: number;
	/**
	 * Where the user goes to type the code. The vendor's own field name is not
	 * settled - RFC 8628 says `verification_uri`, Google's older device flow (the
	 * shape Debrid-Link's grant type comes from) says `verification_url` - so
	 * both are optional here and `deviceVerificationUri` picks whichever arrives.
	 */
	verification_uri?: string;
	verification_url?: string;
}

export interface DebridLinkTokenResponse {
	access_token: string;
	token_type: string;
	/** Seconds. Unmeasured - see the note at the top of this file. */
	expires_in?: number;
	/** Present per the vendor's error documentation; absent would be fine too. */
	refresh_token?: string;
	scope?: string;
}

/** The OAuth endpoints' error shape, which is not the API's `{success,value}`. */
export interface DebridLinkOAuthErrorBody {
	error: string;
	error_description?: string;
}

export class DebridLinkOAuthError extends Error {
	readonly error: string;

	constructor(error: string, description?: string) {
		super(description || error);
		this.name = 'DebridLinkOAuthError';
		this.error = error;
	}
}

/** Polling outcomes that mean "keep going" rather than "give up". */
const PENDING = 'authorization_pending';
const SLOW_DOWN = 'slow_down';

/** Last resort only: the vendor is expected to send one of the two fields. */
const FALLBACK_VERIFICATION_URI = 'https://debrid-link.fr/webapp/device';

export const deviceVerificationUri = (code: Partial<DebridLinkDeviceCode>): string =>
	code.verification_uri || code.verification_url || FALLBACK_VERIFICATION_URI;

const postJson = async <T>(action: string, body: Record<string, unknown> = {}): Promise<T> => {
	const response = await fetch(`${DL_OAUTH_PROXY}/${action}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	const data = await response.json().catch(() => ({
		error: 'non_json_response',
		error_description: `Debrid-Link answered ${response.status}`,
	}));
	if (!response.ok || data?.error) {
		throw new DebridLinkOAuthError(data?.error || 'unknown_error', data?.error_description);
	}
	return data as T;
};

export const requestDebridLinkDeviceCode = (): Promise<DebridLinkDeviceCode> =>
	postJson<DebridLinkDeviceCode>('device');

/**
 * One poll. Resolves with the token once the user has approved, or `null` while
 * the request is still pending; throws once the outcome is terminal.
 *
 * `slow_down` is reported through `onSlowDown` rather than swallowed, because
 * the caller owns the interval and the server expects it to grow.
 */
export async function pollDebridLinkDeviceToken(
	deviceCode: string,
	onSlowDown?: () => void
): Promise<DebridLinkTokenResponse | null> {
	try {
		return await postJson<DebridLinkTokenResponse>('token', { device_code: deviceCode });
	} catch (error) {
		if (error instanceof DebridLinkOAuthError) {
			if (error.error === PENDING) return null;
			if (error.error === SLOW_DOWN) {
				onSlowDown?.();
				return null;
			}
		}
		throw error;
	}
}

/** Exchanges a refresh token for a fresh access token. */
export const refreshDebridLinkToken = (refreshToken: string): Promise<DebridLinkTokenResponse> =>
	postJson<DebridLinkTokenResponse>('refresh', { refresh_token: refreshToken });

export const _testing = { PENDING, SLOW_DOWN, DL_OAUTH_PROXY, FALLBACK_VERIFICATION_URI };
