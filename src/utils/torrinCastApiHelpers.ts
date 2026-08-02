import { getTorrinUser } from '@/services/torrin';
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

export const validateTorrinCreds = (
	req: NextApiRequest,
	res: NextApiResponse
): { baseUrl: string; apiKey: string } | null => {
	const apiKey = req.query.apiKey || req.body?.apiKey;
	const baseUrl = req.query.baseUrl || req.body?.baseUrl;
	if (!apiKey || typeof apiKey !== 'string' || !baseUrl || typeof baseUrl !== 'string') {
		res.status(401).json({ error: 'Invalid or missing Torrin baseUrl/apiKey' });
		return null;
	}
	return { baseUrl, apiKey };
};

export const generateTorrinUserId = async (baseUrl: string, apiKey: string): Promise<string> => {
	try {
		const user = await getTorrinUser(baseUrl, apiKey);
		const identity = user.email || user.username || (user.id != null ? String(user.id) : '');
		if (!identity) {
			throw new Error('Torrin user identity not available');
		}

		const salt = process.env.DMMCAST_SALT;
		if (!salt) {
			throw new Error('DMMCAST_SALT environment variable is not set');
		}

		const normalizedBase = baseUrl.replace(/\/+$/, '');
		const hmac = crypto
			.createHmac('sha256', salt)
			.update(`torrin:${normalizedBase}:${identity}`)
			.digest('base64url');

		return hmac.slice(0, 12);
	} catch (error) {
		throw new Error('Failed to generate Torrin user ID');
	}
};

export const validateTorrinApiKey = async (
	baseUrl: string,
	apiKey: string
): Promise<{ valid: boolean; email?: string }> => {
	try {
		const user = await getTorrinUser(baseUrl, apiKey);
		const identity = user.email || user.username || (user.id != null ? String(user.id) : '');
		if (identity) {
			return { valid: true, email: user.email };
		}
		return { valid: false };
	} catch {
		return { valid: false };
	}
};

export const handleApiError = (error: any, res: NextApiResponse, customMessage?: string) => {
	console.error(customMessage || 'Torrin API Error:', error);
	res.status(500).json({
		error: customMessage || `Internal Server Error: ${error.message || error}`,
	});
};
