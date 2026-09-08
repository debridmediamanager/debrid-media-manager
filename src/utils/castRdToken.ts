import { getToken } from '@/services/realDebrid';

/**
 * The Real-Debrid half of a cast profile: either the OAuth triple or a pasted
 * API key. Exactly one of the two is stored, so every field is optional.
 */
export interface RdCastCredentials {
	clientId?: string | null;
	clientSecret?: string | null;
	refreshToken?: string | null;
	apiKey?: string | null;
}

/**
 * The access token to call Real-Debrid with on this profile's behalf.
 *
 * A pasted API key is already a bearer token for the same REST API the device
 * flow ends at, and it has no expiry - there is nothing to renew, so it is
 * returned as-is. The OAuth triple still mints a fresh 24h token per call,
 * because a stored access token would be stale long before the addon is next
 * opened.
 *
 * Returns null when the profile carries neither, rather than calling `getToken`
 * with empty strings and reading Real-Debrid's 400 as an expired grant.
 * `RdTokenExpiredError` from the refresh is left to propagate: callers turn it
 * into their own "re-authenticate" response.
 */
export async function castAccessToken(profile: RdCastCredentials): Promise<string | null> {
	if (profile.apiKey) return profile.apiKey;
	if (!profile.clientId || !profile.clientSecret || !profile.refreshToken) return null;
	const token = await getToken(
		profile.clientId,
		profile.clientSecret,
		profile.refreshToken,
		true
	);
	return token?.access_token ?? null;
}
