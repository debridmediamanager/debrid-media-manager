import { RdTokenExpiredError, getToken, unrestrictLink } from '@/services/realDebrid';
import { repository as db } from '@/services/repository';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { isDeadRdLink, rdErrorOf } from '@/utils/rdLinkRot';
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
		if (error instanceof RdTokenExpiredError) {
			res.status(403).json({
				error: 'Real-Debrid authorization expired. Please re-authenticate at https://debridmediamanager.com/stremio',
			});
			return;
		}
		console.error(
			'Failed to get Real-Debrid token:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: `Failed to get Real-Debrid token for user ${userid}` });
		return;
	}

	const rdLink = `https://real-debrid.com/d/${link.substring(0, 13)}`;

	// Only ever called for an error RD has told us is permanent - see
	// `isDeadRdLink`. Stops the same dead stream being offered again tomorrow.
	const forgetLink = async (reason: string) => {
		try {
			const [files, casts] = await Promise.all([
				db.removeAvailableFileByLinkPrefix(rdLink),
				db.deleteCastsByLinkPrefix(rdLink),
			]);
			if (files > 0 || casts > 0) {
				console.log(
					`Dropped ${files} available file(s) and ${casts} cast(s) for ${rdLink}: ${reason}`
				);
			}
		} catch (cleanupError) {
			console.error(
				'Failed to drop a dead link:',
				cleanupError instanceof Error ? cleanupError.message : 'Unknown error'
			);
		}
	};

	try {
		const ipAddress = getClientIpFromRequest(req);
		const unrestrict = await unrestrictLink(response.access_token, rdLink, ipAddress, true);
		if (!unrestrict) {
			console.error('Failed to unrestrict link:', rdLink);
			res.status(500).json({ error: 'Failed to unrestrict link' });
			return;
		}

		res.redirect(unrestrict.download);
	} catch (error: any) {
		const rdError = rdErrorOf(error);
		console.error(
			'Failed to play link:',
			error instanceof Error ? error.message : 'Unknown error'
		);

		// A throttled unrestrict (error 34) and a 5xx both look like this and
		// mean nothing about the link. Only RD saying the link or the content is
		// gone earns a delete.
		if (isDeadRdLink(error)) {
			await forgetLink(rdError ?? 'unknown');
		}

		res.status(500).json({ error: 'Failed to play link' });
	}
}
