import { PrismaClient } from '@prisma/client';
import type { NextApiRequest, NextApiResponse } from 'next';

const prisma = new PrismaClient();
const DMM_CAMPAIGN_ID = 'debridmediamanager';
const GITHUB_ACCESS_TIER = 400; // $4.00 minimum for GitHub access

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { code } = req.body;

	if (!code) {
		return res.status(400).json({ error: 'Authorization code is required' });
	}

	try {
		// Exchange the authorization code for access token
		const tokenResponse = await fetch('https://www.patreon.com/api/oauth2/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				code,
				grant_type: 'authorization_code',
				client_id: process.env.PATREON_CLIENT_ID!,
				client_secret: process.env.PATREON_CLIENT_SECRET!,
				redirect_uri: `${process.env.DMM_ORIGIN}/patreoncallback`,
			}),
		});

		if (!tokenResponse.ok) {
			const errorData = await tokenResponse.json();
			console.error('Patreon token exchange error:', errorData);
			throw new Error('Failed to exchange authorization code');
		}

		const tokenData = await tokenResponse.json();

		// Get user's membership status and details
		const membershipResponse = await fetch(
			'https://www.patreon.com/api/oauth2/v2/identity?include=memberships,memberships.currently_entitled_tiers,memberships.campaign&fields[user]=vanity&fields[member]=patron_status&fields[tier]=title,amount_cents&fields[campaign]=vanity',
			{
				headers: {
					Authorization: `Bearer ${tokenData.access_token}`,
					'Content-Type': 'application/json',
				},
			}
		);

		if (!membershipResponse.ok) {
			const errorData = await membershipResponse.json();
			console.error('Patreon membership check error:', errorData);
			throw new Error('Failed to fetch membership status');
		}

		const membershipData = await membershipResponse.json();

		// Find DMM campaign
		const dmmCampaign = membershipData.included?.find(
			(item: any) => item.type === 'campaign' && item.attributes?.vanity === DMM_CAMPAIGN_ID
		);

		// Find active membership for DMM campaign
		const activeMembership = dmmCampaign
			? membershipData.included?.find(
					(item: any) =>
						item.type === 'member' &&
						item.attributes?.patron_status === 'active_patron' &&
						item.relationships?.campaign?.data?.id === dmmCampaign.id
				)
			: null;

		// Find tier for DMM campaign membership
		const entitledTier = activeMembership
			? membershipData.included?.find(
					(item: any) =>
						item.type === 'tier' &&
						activeMembership.relationships?.currently_entitled_tiers?.data?.some(
							(tier: any) => tier.id === item.id
						)
				)
			: null;

		const tierAmountCents = entitledTier?.attributes?.amount_cents || 0;

		// Save or update user in database
		const user = await prisma.user.upsert({
			where: {
				patreonId: membershipData.data.id,
			},
			update: {},
			create: {
				patreonId: membershipData.data.id,
			},
		});

		if (activeMembership && entitledTier) {
			await prisma.patreonSubscription.upsert({
				where: {
					userId: user.id,
				},
				update: {
					tier: entitledTier.attributes.title,
					perks: `$${(tierAmountCents / 100).toFixed(2)} tier`,
				},
				create: {
					userId: user.id,
					tier: entitledTier.attributes.title,
					perks: `$${(tierAmountCents / 100).toFixed(2)} tier`,
				},
			});
		} else {
			// If not a DMM patron, delete subscription
			await prisma.patreonSubscription.deleteMany({
				where: {
					userId: user.id,
				},
			});
		}

		return res.status(200).json({
			...tokenData,
			isActivePatron: !!activeMembership,
			userId: user.id,
			user: {
				username: membershipData.data.attributes.vanity || 'Patron',
				tier: entitledTier?.attributes?.title || 'None',
				tierAmount: tierAmountCents,
				canAccessGithub: tierAmountCents >= GITHUB_ACCESS_TIER,
			},
		});
	} catch (error) {
		console.error('Patreon authentication error:', error);
		return res.status(500).json({ error: 'Authentication failed' });
	}
}
