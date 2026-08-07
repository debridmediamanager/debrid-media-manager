import { getAllDebridUser } from '@/services/allDebrid';
import crypto from 'crypto';
import { NextApiRequest, NextApiResponse } from 'next';

export const validateMethod = (
	req: NextApiRequest,
	res: NextApiResponse,
	allowedMethods: string[]
): boolean => {
	if (!allowedMethods.includes(req.method || '')) {
		res.setHeader('Allow', allowedMethods);
		res.status(405).end(`Method ${req.method} Not Allowed`);
		return false;
	}
	return true;
};

// Read from the body only. The key used to be accepted from the query string,
// which wrote it verbatim into nginx and Cloudflare access logs.
export const validateApiKey = (req: NextApiRequest, res: NextApiResponse): string | null => {
	const apiKey = req.body?.apiKey;
	if (!apiKey || typeof apiKey !== 'string') {
		res.status(401).json({ error: 'Invalid or missing API key' });
		return null;
	}
	return apiKey;
};

const deriveUserId = (username: string): string => {
	const salt = process.env.DMMCAST_SALT;
	if (!salt) {
		throw new Error('DMMCAST_SALT environment variable is not set');
	}

	// Prefixed with 'alldebrid:' to ensure different IDs from RD/TB
	const hmac = crypto
		.createHmac('sha256', salt)
		.update(`alldebrid:${username}`)
		.digest('base64url'); // base64url is URL-safe (no +, /, or =)

	// Return 12 characters for collision resistance
	return hmac.slice(0, 12);
};

/**
 * One AllDebrid round trip for both the validity check and the user id.
 *
 * Callers used to run validateAllDebridApiKey and generateAllDebridUserId back
 * to back, which hit /v4.1/user twice per request from our server. AllDebrid
 * emails users about unfamiliar IPs using their key, so every duplicate call
 * was another alert naming dmm-01.
 */
export const resolveAllDebridUser = async (
	apiKey: string
): Promise<{ valid: boolean; userId?: string; username?: string; isPremium?: boolean }> => {
	let userData;
	try {
		userData = await getAllDebridUser(apiKey);
	} catch {
		return { valid: false };
	}

	if (!userData?.username) {
		return { valid: false };
	}

	// Deliberately outside the catch: a missing salt is our misconfiguration and
	// should surface as a 500, not as "invalid AllDebrid API key".
	return {
		valid: true,
		userId: deriveUserId(userData.username),
		username: userData.username,
		isPremium: userData.isPremium,
	};
};

export const generateAllDebridUserId = async (apiKey: string): Promise<string> => {
	try {
		const userData = await getAllDebridUser(apiKey);
		if (!userData?.username) {
			throw new Error('Invalid AllDebrid API key or username not available');
		}

		return deriveUserId(userData.username);
	} catch (error) {
		throw new Error('Failed to generate AllDebrid user ID');
	}
};

export const validateAllDebridApiKey = async (
	apiKey: string
): Promise<{ valid: boolean; username?: string; isPremium?: boolean }> => {
	try {
		const userData = await getAllDebridUser(apiKey);
		if (userData?.username) {
			return {
				valid: true,
				username: userData.username,
				isPremium: userData.isPremium,
			};
		}
		return { valid: false };
	} catch {
		return { valid: false };
	}
};

export const handleApiError = (error: any, res: NextApiResponse, customMessage?: string) => {
	console.error(customMessage || 'AllDebrid API Error:', error);
	res.status(500).json({
		error: customMessage || `Internal Server Error: ${error.message || error}`,
	});
};

// Encrypt API key for storage (simple passthrough for now)
export const encryptApiKey = (apiKey: string): string => {
	// In production, you might want to use proper encryption
	// For now, we'll store it as-is since it's already a secret
	return apiKey;
};

// Decrypt API key from storage
export const decryptApiKey = (encryptedApiKey: string): string => {
	return encryptedApiKey;
};
