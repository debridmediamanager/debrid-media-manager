import {
	checkEasynewsLogin,
	EasynewsAuthError,
	type EasynewsCredentials,
} from '@/services/easynews';
import crypto from 'crypto';
import { easynewsCredentialsOf } from './easynewsCastKey';

/**
 * The cast id for an Easynews account: keyed on the username, so a changed
 * password keeps the same addon URL and casts. Easynews usernames are not case
 * sensitive at sign-in, so neither is the id.
 */
export function easynewsCastUserId(username: string): string {
	const salt = process.env.DMMCAST_SALT;
	if (!salt) {
		throw new Error('DMMCAST_SALT environment variable is not set');
	}
	// Prefixed so the id can never equal another provider's.
	return crypto
		.createHmac('sha256', salt)
		.update(`easynews:${username.toLowerCase()}`)
		.digest('base64url')
		.slice(0, 12);
}

/**
 * Whether Easynews takes the login inside a cast key, and its cast id. The
 * members-page check does not use one of the account's two search slots.
 * Easynews being down throws, so it is not reported as a wrong password.
 */
export async function resolveEasynewsUser(
	key: unknown
): Promise<{ valid: boolean; userId?: string; credentials?: EasynewsCredentials }> {
	const credentials = easynewsCredentialsOf(key);
	if (!credentials) return { valid: false };
	try {
		await checkEasynewsLogin(credentials);
	} catch (error) {
		if (error instanceof EasynewsAuthError) return { valid: false };
		throw error;
	}
	return { valid: true, userId: easynewsCastUserId(credentials.username), credentials };
}
