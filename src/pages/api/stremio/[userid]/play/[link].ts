import { unrestrictLink } from '@/services/realDebrid';
import { repository as db } from '@/services/repository';
import { BLOCKED_MESSAGE, getBlocklist, isHashBlockedIn } from '@/services/takedown/blocklist';
import {
	classifyCastError,
	classifyRdPlayError,
	providerErrorDetail,
} from '@/utils/castAddonFailure';
import { sendPlayFailure } from '@/utils/castAddonResponses';
import { castAccessToken, forgetCastAccessToken, RdCastCredentials } from '@/utils/castRdToken';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { isRdLinkId, RD_DOWNLOAD_LINK_PREFIX } from '@/utils/rdCastLink';
import { isDeadRdLink, rdErrorOf } from '@/utils/rdLinkRot';
import { NextApiRequest, NextApiResponse } from 'next';

/** What Real-Debrid said, for the log: `403 permission_denied/9`. */
const describeRdError = (error: unknown) => {
	const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
	const { error: rdError, code } = providerErrorDetail(error);
	if (typeof status === 'number') {
		return [status, [rdError, code].filter((part) => part !== undefined).join('/')]
			.filter(Boolean)
			.join(' ');
	}
	return error instanceof Error ? error.message : 'Unknown error';
};

const unauthorized = (error: unknown) =>
	(error as { response?: { status?: unknown } } | null)?.response?.status === 401;

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

	let profile: RdCastCredentials | null;
	try {
		profile = await db.getCastProfile(userid);
	} catch (error) {
		return sendPlayFailure(res, 'rd', 'unavailable', describeRdError(error));
	}
	if (!profile) {
		return sendPlayFailure(res, 'rd', 'not-connected', 'no cast profile');
	}

	let accessToken: string | null;
	try {
		accessToken = await castAccessToken(profile);
	} catch (error) {
		// RdTokenExpiredError is the member's sign-in; a dropped connection or
		// a 5xx from the token endpoint is Real-Debrid's bad minute.
		return sendPlayFailure(res, 'rd', classifyCastError(error), describeRdError(error));
	}
	if (!accessToken) {
		return sendPlayFailure(res, 'rd', 'not-connected', 'profile holds no credential');
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

	const ipAddress = getClientIpFromRequest(req);
	try {
		let unrestrict;
		try {
			unrestrict = await unrestrictLink(accessToken, rdLink, ipAddress, true);
		} catch (error) {
			// A 401 here with a credential that mints fine means the access token
			// cached for it went bad before its expiry. One fresh token settles
			// which: a working one plays, a refused one is the member's sign-in.
			if (!unauthorized(error) || !forgetCastAccessToken(profile)) throw error;
			const freshToken = await castAccessToken(profile);
			if (!freshToken) throw error;
			unrestrict = await unrestrictLink(freshToken, rdLink, ipAddress, true);
		}
		if (!unrestrict?.download) {
			return sendPlayFailure(res, 'rd', 'unavailable', 'unrestrict returned no link');
		}

		res.redirect(unrestrict.download);
	} catch (error) {
		// A throttled unrestrict (error 34) and a 5xx both land here and mean
		// nothing about the link, and neither does any 401 or 403. Only RD
		// saying the link or the content is gone earns a delete.
		if (isDeadRdLink(error)) {
			await forgetLink(rdErrorOf(error) ?? 'unknown');
		}
		return sendPlayFailure(res, 'rd', classifyRdPlayError(error), describeRdError(error));
	}
}
