import { PrismaClient } from '@prisma/client';
import type { NextApiRequest, NextApiResponse } from 'next';

const prisma = new PrismaClient();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { code } = req.body;

	if (!code) {
		return res.status(400).json({ error: 'Authorization code is required' });
	}

	try {
		// Exchange the code for an access token
		const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				client_id: process.env.GITHUB_CLIENT_ID,
				client_secret: process.env.GITHUB_CLIENT_SECRET,
				code,
				redirect_uri: `${process.env.DMM_ORIGIN}/githubcallback`,
			}),
		});

		const tokenData = await tokenResponse.json();

		if (tokenData.error) {
			console.error('GitHub token exchange error:', tokenData);
			throw new Error(tokenData.error_description || 'Failed to exchange authorization code');
		}

		// Get user info
		const userResponse = await fetch('https://api.github.com/user', {
			headers: {
				Authorization: `token ${tokenData.access_token}`,
				Accept: 'application/json',
			},
		});

		if (!userResponse.ok) {
			throw new Error('Failed to fetch user info');
		}

		const userData = await userResponse.json();

		// Update user in database with GitHub ID
		const userId = req.body.userId; // This should be passed from the frontend
		if (!userId) {
			throw new Error('User ID is required');
		}

		await prisma.user.update({
			where: {
				id: parseInt(userId),
			},
			data: {
				githubId: userData.id.toString(),
			},
		});

		return res.status(200).json({
			access_token: tokenData.access_token,
			username: userData.login,
		});
	} catch (error) {
		console.error('GitHub authentication error:', error);
		return res.status(500).json({ error: 'Authentication failed' });
	}
}
