import { BAD_TOKEN, DebridLinkError } from '@/services/debridLink';
import { handleDebridLinkOAuthRequest } from '@/services/debridLinkOAuthProxy';
import { repository as db } from '@/services/repository';

interface CastCredential {
	apiKey: string;
	refreshToken?: string | null;
}

// Coalesce renewals within this worker. Re-read storage too: another worker or
// browser may already have renewed the rejected access token.
const renewing = new Map<string, Promise<string>>();

async function renew(userId: string, rejected: CastCredential): Promise<string> {
	const pending = renewing.get(userId);
	if (pending) return pending;

	const renewal = (async () => {
		const current = await db.getDebridLinkCastProfile(userId);
		if (!current) throw new Error('Debrid-Link Cast profile no longer exists');
		if (current.apiKey !== rejected.apiKey) return current.apiKey;
		if (!current.refreshToken) throw new Error('Debrid-Link sign-in required');

		const result = await handleDebridLinkOAuthRequest({
			method: 'POST',
			action: 'refresh',
			body: { refresh_token: current.refreshToken },
		});
		const accessToken = result.body.access_token;
		if (result.httpStatus !== 200 || typeof accessToken !== 'string' || !accessToken) {
			// Do not surface provider descriptions: they may echo credentials.
			throw new Error('Debrid-Link credential renewal failed - sign in again on DMM');
		}
		const refreshToken =
			typeof result.body.refresh_token === 'string' && result.body.refresh_token
				? result.body.refresh_token
				: current.refreshToken;
		await db.saveDebridLinkCastProfile(
			userId,
			accessToken,
			undefined,
			undefined,
			undefined,
			undefined,
			refreshToken
		);
		return accessToken;
	})();
	const tracked = renewal.finally(() => renewing.delete(userId));
	renewing.set(userId, tracked);
	return tracked;
}

/** Retry once on badToken; quota, lockout and other refusals never trigger OAuth. */
export async function withDebridLinkCastToken<T>(
	userId: string,
	profile: CastCredential,
	operation: (token: string) => Promise<T>
): Promise<T> {
	try {
		return await operation(profile.apiKey);
	} catch (error) {
		if (
			!(error instanceof DebridLinkError) ||
			error.code !== BAD_TOKEN ||
			!profile.refreshToken
		) {
			throw error;
		}
		const token = await renew(userId, profile);
		return operation(token);
	}
}
