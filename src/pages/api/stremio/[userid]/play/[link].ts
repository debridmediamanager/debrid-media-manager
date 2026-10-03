import { RdTokenExpiredError, unrestrictLink } from '@/services/realDebrid';
import { repository as db } from '@/services/repository';
import { BLOCKED_MESSAGE, getBlocklist, isHashBlockedIn } from '@/services/takedown/blocklist';
import { castAccessToken } from '@/utils/castRdToken';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { isRdLinkId, RD_DOWNLOAD_LINK_PREFIX } from '@/utils/rdCastLink';
import { isDeadRdLink, rdErrorOf } from '@/utils/rdLinkRot';
import { NextApiRequest, NextApiResponse } from 'next';

// Unrestrict and play a link
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

	const { userid, link } = req.query;
	// Not every id that arrives here is a Real-Debrid one: stream lists served
	// before Debridio markers were left out carried a slice of an infohash. RD
	// can only refuse those, and the cleanup below deletes every row whose link
	// starts with what it is given - for a short id, a great many rows.
	if (typeof userid !== 'string' || typeof link !== 'string' || !isRdLinkId(link)) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid" or "link" query parameter',
		});
		return;
	}

	let profile: {
		clientId: string | null;
		clientSecret: string | null;
		refreshToken: string | null;
		apiKey: string | null;
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

	let accessToken: string | null = null;
	try {
		accessToken = await castAccessToken(profile);
		if (!accessToken) {
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

	const rdLink = `${RD_DOWNLOAD_LINK_PREFIX}${link.substring(0, 13)}`;

	// A stream list handed out before a takedown can outlive it in a client.
	// The lookup is skipped while nothing is blocked; `link` is the primary
	// key, so the prefix match is an index range when it runs.
	const blocklist = await getBlocklist();
	if (
		blocklist.hashes.size > 0 &&
		isHashBlockedIn(blocklist, await db.getHashByLink(rdLink).catch(() => null))
	) {
		res.status(451).json({ error: BLOCKED_MESSAGE });
		return;
	}

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
		const unrestrict = await unrestrictLink(accessToken, rdLink, ipAddress, true);
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
