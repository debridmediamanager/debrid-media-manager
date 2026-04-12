import { getToken, unrestrictLink } from '@/services/realDebrid';
import { repository as db } from '@/services/repository';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { NextApiRequest, NextApiResponse } from 'next';

// Unrestrict and play a link
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

	const { userid, link } = req.query;
	if (typeof userid !== 'string' || typeof link !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid" or "link" query parameter',
		});
		return;
	}

	let profile: {
		clientId: string;
		clientSecret: string;
		refreshToken: string;
	} | null = null;
	try {
		profile = await db.getCastProfile(userid);
		if (!profile) {
			throw new Error(`no profile found for user ${userid}`);
		}
	} catch (error) {
		console.error(
			'Failed to get Cast profile:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: `Failed to get Cast profile for user ${userid}` });
		return;
	}

	let response: { access_token: string } | null = null;
	try {
		response = await getToken(
			profile.clientId,
			profile.clientSecret,
			profile.refreshToken,
			true
		);
		if (!response) {
			throw new Error(`no token found for user ${userid}`);
		}
	} catch (error) {
		console.error(
			'Failed to get Real-Debrid token:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: `Failed to get Real-Debrid token for user ${userid}` });
		return;
	}

	const rdLink = `https://real-debrid.com/d/${link.substring(0, 13)}`;

	try {
		const ipAddress = getClientIpFromRequest(req);
		const unrestrict = await unrestrictLink(response.access_token, rdLink, ipAddress, true);
		if (!unrestrict) {
			console.error('Failed to unrestrict link:', rdLink);

			const hash = await db.getHashByLink(rdLink);
			if (hash) {
				console.log(
					`Removing availability for hash ${hash} due to unrestrict failure for link ${rdLink}`
				);
				await db.removeAvailability(hash);
			}

			res.status(500).json({ error: 'Failed to unrestrict link' });
			return;
		}

		res.redirect(unrestrict.download);
	} catch (error: any) {
		console.error(
			'Failed to play link:',
			error instanceof Error ? error.message : 'Unknown error'
		);

		const hash = await db.getHashByLink(rdLink);
		if (hash) {
			console.log(
				`Removing availability for hash ${hash} due to error playing link ${rdLink}`
			);
			await db.removeAvailability(hash);
		}

		res.status(500).json({ error: 'Failed to play link' });
	}
}
