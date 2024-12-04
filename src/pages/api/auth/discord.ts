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
		const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				client_id: process.env.DISCORD_CLIENT_ID!,
				client_secret: process.env.DISCORD_CLIENT_SECRET!,
				code,
				grant_type: 'authorization_code',
				redirect_uri: `${process.env.DMM_ORIGIN}/discordcallback`,
				scope: 'identify',
			}),
		});

		const tokenData = await tokenResponse.json();

		if (tokenData.error) {
			console.error('Discord token exchange error:', tokenData);
			throw new Error(tokenData.error_description || 'Failed to exchange authorization code');
		}

		// Get user info
		const userResponse = await fetch('https://discord.com/api/users/@me', {
			headers: {
				Authorization: `Bearer ${tokenData.access_token}`,
			},
		});

		if (!userResponse.ok) {
			throw new Error('Failed to fetch user info');
		}

		const userData = await userResponse.json();

		// Update user in database with Discord ID
		const userId = req.body.userId; // This should be passed from the frontend
		if (!userId) {
			throw new Error('User ID is required');
		}

		await prisma.user.update({
			where: {
				id: parseInt(userId),
			},
			data: {
				discordId: userData.id,
			},
		});

		return res.status(200).json({
			access_token: tokenData.access_token,
			username: userData.username,
			discriminator: userData.discriminator,
		});
	} catch (error) {
		console.error('Discord authentication error:', error);
		return res.status(500).json({ error: 'Authentication failed' });
	}
}
