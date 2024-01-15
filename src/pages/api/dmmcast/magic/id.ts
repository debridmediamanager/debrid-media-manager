import { UserResponse } from '@/services/realDebrid';
import axios from 'axios';
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

	const crypto = require('crypto');

	let hash = crypto
		.createHash('md5')
		.update(username + salt)
		.digest('hex');

	res.status(200).json({
		id: hash,
	});
}
