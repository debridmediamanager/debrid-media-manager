import { getCurrentUser } from '@/services/realDebrid';
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

export const extractToken = (req: NextApiRequest): string | null => {
	// Check Authorization: Bearer header first
	const authHeader = req.headers.authorization;
	if (typeof authHeader === 'string') {
		const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
		if (bearerMatch) {
			const token = bearerMatch[1].trim();
			if (token) return token;
		}
	}
	// Fall back to query param
	const queryToken = req.query.token;
	if (queryToken && typeof queryToken === 'string') return queryToken;
	// Fall back to request body
	const bodyToken = req.body?.token;
	if (bodyToken && typeof bodyToken === 'string') return bodyToken;
	return null;
};

export const validateToken = (req: NextApiRequest, res: NextApiResponse): string | null => {
	const token = extractToken(req);
	if (!token) {
		res.status(401).json({ error: 'Invalid or missing token' });
		return null;
	}
	return token;
};

export const generateUserId = async (token: string): Promise<string> => {
	try {
		const { username } = await getCurrentUser(token);
		if (!username) {
			throw new Error('Invalid username');
		}

		let salt = process.env.DMMCAST_SALT;
		if (!salt || salt === 'your-random-salt-here') {
			console.warn('WARNING: DMMCAST_SALT is missing or insecure in environment variables. Using a temporary random salt. Cast profiles will not persist across server restarts. Please set DMMCAST_SALT securely in your .env file.');
			
			// We can't persist it, but we can store it in memory for the session
			const globalAny = global as any;
			salt = globalAny.__DMMCAST_TEMP_SALT || (globalAny.__DMMCAST_TEMP_SALT = crypto.randomBytes(32).toString('hex'));
		}

		const hmac = crypto.createHmac('sha256', salt as string).update(username).digest('base64url');

		// Return 12 characters for much better collision resistance
		// With 62^12 possible values, collision probability is effectively 0 for millions of users
		return hmac.slice(0, 12);
	} catch (error) {
		throw new Error('Failed to generate user ID');
	}
};

// Legacy 5-character token generator for backward compatibility during migration
export const generateLegacyUserId = async (token: string): Promise<string> => {
	try {
		const { username } = await getCurrentUser(token);
		if (!username) {
			throw new Error('Invalid username');
		}

		let salt = process.env.DMMCAST_SALT;
		if (!salt || salt === 'your-random-salt-here') {
			const globalAny = global as any;
			salt = globalAny.__DMMCAST_TEMP_SALT || (globalAny.__DMMCAST_TEMP_SALT = crypto.randomBytes(32).toString('hex'));
		}

		const hash = crypto
			.createHash('sha256')
			.update(username + salt)
			.digest('base64')
			.replace(/\+/g, 'a')
			.replace(/\//g, 'b')
			.replace(/=/g, '');

		return hash.slice(0, 5);
	} catch (error) {
		throw new Error('Failed to generate user ID');
	}
};

export const isLegacyToken = (token: string): boolean => {
	// Legacy tokens are exactly 5 characters long
	// New tokens are 12 characters long
	return token.length === 5;
};

export const handleApiError = (error: any, res: NextApiResponse, customMessage?: string) => {
	console.error(customMessage || 'API Error:', error);
	res.status(500).json({
		error: customMessage || `Internal Server Error: ${error}`,
	});
};
