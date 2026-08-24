import { getPremiumizeAccountInfo } from '@/services/premiumize';
import crypto from 'crypto';

const deriveUserId = (customerId: string): string => {
	const salt = process.env.DMMCAST_SALT;
	if (!salt) {
		throw new Error('DMMCAST_SALT environment variable is not set');
	}

	// Prefixed with 'premiumize:' to ensure different IDs from RD/AD/TB
	const hmac = crypto
		.createHmac('sha256', salt)
		.update(`premiumize:${customerId}`)
		.digest('base64url'); // base64url is URL-safe (no +, /, or =)

	// Return 12 characters for collision resistance
	return hmac.slice(0, 12);
};

/**
 * One Premiumize round trip for both the validity check and the user id.
 *
 * Keyed on `customer_id` rather than an email: it is the account's own stable
 * identifier and it is what Premiumize embeds in a minted CDN URL, so it cannot
 * drift the way a changed email would - which would orphan a user's whole cast
 * library behind a new id.
 */
export const resolvePremiumizeUser = async (
	apiKey: string
): Promise<{ valid: boolean; userId?: string; customerId?: string }> => {
	let info;
	try {
		info = await getPremiumizeAccountInfo(apiKey);
	} catch {
		return { valid: false };
	}

	if (!info?.customer_id) {
		return { valid: false };
	}

	// Deliberately outside the catch: a missing salt is our misconfiguration and
	// should surface as a 500, not as "invalid Premiumize API key".
	return { valid: true, userId: deriveUserId(info.customer_id), customerId: info.customer_id };
};

export const generatePremiumizeUserId = async (apiKey: string): Promise<string> => {
	const { valid, userId } = await resolvePremiumizeUser(apiKey);
	if (!valid || !userId) {
		throw new Error('Failed to generate Premiumize user ID');
	}
	return userId;
};
