import { UserResponse } from '@/services/types';
import axios from 'axios';
import crypto from 'crypto';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { token } = req.query;
	if (!token) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "token" query parameter',
		});
		return;
	}
	if (typeof token !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "token" query parameter',
		});
		return;
	}

	let username = '';
	try {
		const headers = {
			Authorization: `Bearer ${token}`,
		};

		const response = await axios.get<UserResponse>(
			`https://api.real-debrid.com/rest/1.0/user`,
			{ headers }
		);

		username = response.data.username;
		if (!username) {
			throw new Error('Invalid username');
		}
	} catch (error: any) {
		res.status(500).json({
			status: 'error',
			errorMessage: error.message,
		});
		return;
	}
	const salt =
		process.env.DMMCAST_SALT ??
		'piyeJUVdDoLLf3q&i9NRkrfVmTDg$&KYZ5CEJmswjv5yetjwsyxrMHqdNuvw^$a7mZh^bgqg8K4kMKptFFEp4*RcQ!&Dmd9uvnqAF&zRqts4YwRzTqjGErp9j4wHVVTw';

	let hash = crypto
		.createHash('sha256')
		.update(username + salt)
		.digest('base64')
		.replace(/\+/g, 'a')
		.replace(/\//g, 'b')
		.replace(/=/g, '');

	res.status(200).json({
		id: hash.slice(0, 5),
	});
}
