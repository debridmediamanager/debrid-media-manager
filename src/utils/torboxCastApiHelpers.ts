import { getUserData } from '@/services/torbox';
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

export const validateApiKey = (req: NextApiRequest, res: NextApiResponse): string | null => {
	const apiKey = req.query.apiKey || req.body.apiKey;
	if (!apiKey || typeof apiKey !== 'string') {
		res.status(401).json({ error: 'Invalid or missing API key' });
		return null;
	}
	return apiKey;
};

export const generateTorBoxUserId = async (apiKey: string): Promise<string> => {
	try {
		const userData = await getUserData(apiKey);
		if (!userData.success || !userData.data?.email) {
			throw new Error('Invalid TorBox API key or email not available');
		}

		const email = userData.data.email;

		const salt = process.env.DMMCAST_SALT;
		if (!salt) {
			throw new Error('DMMCAST_SALT environment variable is not set');
		}

		// Prefixed with 'torbox:' to ensure different IDs from RD
		const hmac = crypto
			.createHmac('sha256', salt)
			.update(`torbox:${email}`)
			.digest('base64url'); // base64url is URL-safe (no +, /, or =)

		// Return 12 characters for collision resistance
		return hmac.slice(0, 12);
	} catch (error) {
		throw new Error('Failed to generate TorBox user ID');
	}
};

export const validateTorBoxApiKey = async (
	apiKey: string
): Promise<{ valid: boolean; email?: string }> => {
	try {
		const userData = await getUserData(apiKey);
		if (userData.success && userData.data?.email) {
			return { valid: true, email: userData.data.email };
		}
		return { valid: false };
	} catch {
		return { valid: false };
	}
};

export const handleApiError = (error: any, res: NextApiResponse, customMessage?: string) => {
	console.error(customMessage || 'TorBox API Error:', error);
	res.status(500).json({
		error: customMessage || `Internal Server Error: ${error.message || error}`,
	});
};

// Encrypt API key for storage (simple base64 for now, can be enhanced)
export const encryptApiKey = (apiKey: string): string => {
	// In production, you might want to use proper encryption
	// For now, we'll store it as-is since it's already a secret
	return apiKey;
};

// Decrypt API key from storage
export const decryptApiKey = (encryptedApiKey: string): string => {
	return encryptedApiKey;
};
