import { PrismaClient } from '@prisma/client';
import type { NextApiRequest, NextApiResponse } from 'next';

const prisma = new PrismaClient();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { id } = req.query;

	if (!id || Array.isArray(id)) {
		return res.status(400).json({ error: 'Invalid user ID' });
	}

	try {
		const user = await prisma.user.findUnique({
			where: {
				id: parseInt(id),
			},
			select: {
				id: true,
				patreonId: true,
				githubId: true,
				discordId: true,
				patreonSubscription: {
					select: {
						tier: true,
						subscriptionDate: true,
					},
				},
			},
		});

		if (!user) {
			return res.status(404).json({ error: 'User not found' });
		}

		return res.status(200).json(user);
	} catch (error) {
		console.error('Error fetching user:', error);
		return res.status(500).json({ error: 'Failed to fetch user details' });
	}
}
