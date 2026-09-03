import { getOffcloudAccountInfo, getOffcloudCacheInfo } from '@/services/offcloud';
import { offcloudVideoFiles, type OffcloudVideoFile } from '@/utils/offcloudCastFiles';
import crypto from 'crypto';

const deriveUserId = (accountUserId: string): string => {
	const salt = process.env.DMMCAST_SALT;
	if (!salt) {
		throw new Error('DMMCAST_SALT environment variable is not set');
	}

	// Prefixed with 'offcloud:' to ensure different IDs from RD/AD/TB/PM
	const hmac = crypto
		.createHmac('sha256', salt)
		.update(`offcloud:${accountUserId}`)
		.digest('base64url'); // base64url is URL-safe (no +, /, or =)

	// Return 12 characters for collision resistance
	return hmac.slice(0, 12);
};

/**
 * One Offcloud round trip for both the validity check and the user id.
 *
 * Keyed on `user_id` rather than the email `account/info` also returns: it is
 * the account's own stable identifier and it is what Offcloud embeds in every
 * minted CDN URL, so it cannot drift the way a changed email would - which
 * would orphan a user's whole cast library behind a new id.
 *
 * `account/info` is the entire introspection surface Offcloud offers, so this
 * is the cheapest check available; there is no lighter "is this key valid"
 * endpoint. A bad key answers `401 {"error":"NOAUTH"}` and nothing
 * distinguishes missing from malformed from revoked.
 */
export const resolveOffcloudUser = async (
	apiKey: string
): Promise<{ valid: boolean; userId?: string; accountUserId?: string }> => {
	let info;
	try {
		info = await getOffcloudAccountInfo(apiKey);
	} catch {
		return { valid: false };
	}

	if (!info?.user_id) {
		return { valid: false };
	}

	// Deliberately outside the catch: a missing salt is our misconfiguration and
	// should surface as a 500, not as "invalid Offcloud API key".
	return {
		valid: true,
		userId: deriveUserId(String(info.user_id)),
		accountUserId: String(info.user_id),
	};
};

export const generateOffcloudUserId = async (apiKey: string): Promise<string> => {
	const { valid, userId } = await resolveOffcloudUser(apiKey);
	if (!valid || !userId) {
		throw new Error('Failed to generate Offcloud user ID');
	}
	return userId;
};

/**
 * The video files of a cached release, resolved without touching the account.
 *
 * `POST /api/cache/info` with `includeFiles` returns folder, filename and byte
 * size per file for a hash Offcloud holds, and adds nothing - strictly more
 * than Premiumize's own probe returns off the same cache, and the reason the
 * cast routes never have to add a torrent to enumerate its episodes.
 *
 * An empty result is the honest answer for content Offcloud does not hold. It
 * is also the right answer for the cast: play resolves by hash with the
 * *viewer's* key, so casting a release Offcloud's cache is missing produces a
 * stream nobody but its owner could ever play.
 */
export const resolveCachedOffcloudFiles = async (
	apiKey: string,
	hash: string
): Promise<OffcloudVideoFile[]> => {
	// Always the magnet form, which `getOffcloudCacheInfo` builds: a bare hash
	// here answers `cached: false` for content that is cached.
	const [info] = await getOffcloudCacheInfo(apiKey, [hash]);
	if (!info?.cached) return [];
	return offcloudVideoFiles(info.files);
};
