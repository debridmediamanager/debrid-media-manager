import { UserResponse } from '@/services/types';
import axios from 'axios';
import crypto from 'crypto';
import { NextApiRequest, NextApiResponse } from 'next';

export type ApiHandler = (req: NextApiRequest, res: NextApiResponse) => Promise<void>;

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

export const validateToken = (req: NextApiRequest, res: NextApiResponse): string | null => {
	const token = req.query.token || req.body.token;
	if (!token || typeof token !== 'string') {
		res.status(401).json({ error: 'Invalid or missing token' });
		return null;
	}
	return token;
};

export const generateUserId = async (token: string): Promise<string> => {
	try {
		const headers = {
			Authorization: `Bearer ${token}`,
		};

		const response = await axios.get<UserResponse>(
			'https://app.real-debrid.com/rest/1.0/user',
			{ headers }
		);

		const username = response.data.username;
		if (!username) {
			throw new Error('Invalid username');
		}

		const salt =
			process.env.DMMCAST_SALT ??
			'piyeJUVdDoLLf3q&i9NRkrfVmTDg$&KYZ5CEJmswjv5yetjwsyxrMHqdNuvw^$a7mZh^bgqg8K4kMKptFFEp4*RcQ!&Dmd9uvnqAF&zRqts4YwRzTqjGErp9j4wHVVTw';

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

export const handleApiError = (error: any, res: NextApiResponse, customMessage?: string) => {
	console.error(customMessage || 'API Error:', error);
	res.status(500).json({
		error: customMessage || `Internal Server Error: ${error}`,
	});
};
