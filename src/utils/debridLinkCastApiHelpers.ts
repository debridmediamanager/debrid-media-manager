import {
	addSeedboxTorrent,
	DebridLinkError,
	getDebridLinkAccountInfo,
	getSeedboxTorrent,
	isDlFinished,
	toMagnetUri,
	type DebridLinkTorrent,
} from '@/services/debridLink';
import { debridLinkVideoFiles, type DebridLinkVideoFile } from '@/utils/debridLinkCastFiles';
import crypto from 'crypto';

const deriveUserId = (accountIdentity: string): string => {
	const salt = process.env.DMMCAST_SALT;
	if (!salt) {
		throw new Error('DMMCAST_SALT environment variable is not set');
	}

	// Prefixed with 'debridlink:' to ensure different IDs from RD/AD/TB/PM/OC
	const hmac = crypto
		.createHmac('sha256', salt)
		.update(`debridlink:${accountIdentity}`)
		.digest('base64url'); // base64url is URL-safe (no +, /, or =)

	// Return 12 characters for collision resistance
	return hmac.slice(0, 12);
};

/**
 * One Debrid-Link round trip for both the validity check and the user id.
 *
 * Keyed on `username`, because it is the only stable identifier the API hands
 * out: `/account/infos` returns no numeric user id at all, and the `email` it
 * does return is **partially masked** (`p**d@deb*******k`) as well as being a
 * thing a user can change - either would orphan a whole cast library behind a
 * new id.
 *
 * `account/infos` is also the cheapest check available; there is no lighter "is
 * this token valid" endpoint, and spending more than one request to find out is
 * a step towards the hour-long per-endpoint lockout.
 */
export const resolveDebridLinkUser = async (
	token: string
): Promise<{ valid: boolean; userId?: string; username?: string; premium?: boolean }> => {
	let info;
	try {
		info = await getDebridLinkAccountInfo(token);
	} catch {
		return { valid: false };
	}

	if (!info?.username) {
		return { valid: false };
	}

	// Deliberately outside the catch: a missing salt is our misconfiguration and
	// should surface as a 500, not as "invalid Debrid-Link token".
	return {
		valid: true,
		userId: deriveUserId(String(info.username)),
		username: String(info.username),
		premium: info.accountType === 1,
	};
};

export const generateDebridLinkUserId = async (token: string): Promise<string> => {
	const { valid, userId } = await resolveDebridLinkUser(token);
	if (!valid || !userId) {
		throw new Error('Failed to generate Debrid-Link user ID');
	}
	return userId;
};

/**
 * A user-facing sentence for the Debrid-Link error codes a cast or a play can
 * actually hit.
 *
 * Every one of these is a real refusal with a real cause the user can act on,
 * and none of them is a bug in DMM - which is why they are spelled out rather
 * than collapsed into "Debrid-Link error". The quota numbers are the measured
 * premium-account limits (`docs/providers/debrid-link.md` section 4).
 */
export const describeDebridLinkError = (error: unknown): string => {
	if (!(error instanceof DebridLinkError)) {
		return error instanceof Error ? error.message : 'Unknown error';
	}

	switch (error.code) {
		case 'maxTorrent':
			return 'Debrid-Link daily torrent quota reached (50 per day) - try again after the daily reset.';
		case 'maxData':
			return 'Debrid-Link daily data quota reached (400 GiB per day).';
		case 'maxTransfer':
			return 'Debrid-Link is already running its maximum of 20 active transfers.';
		case 'torrentTooBig':
			return 'This release is past Debrid-Link’s 1 TiB per-torrent limit.';
		case 'floodDetected':
			return 'Debrid-Link rate-limited this endpoint for an hour - nothing to do but wait it out.';
		case 'notAddTorrent':
			return 'Not cached on Debrid-Link, and it would not take the download.';
		case 'badTorrentFile':
			return 'Debrid-Link rejected this magnet.';
		case 'badToken':
			return 'The stored Debrid-Link credential is no longer valid - sign in again on DMM.';
		case 'serverNotAllowed':
			return 'Debrid-Link refuses this account from a datacenter or VPN address.';
		default:
			return error.message || `Debrid-Link error: ${error.code}`;
	}
};

export interface DebridLinkResolvedRelease {
	torrent: DebridLinkTorrent;
	files: DebridLinkVideoFile[];
	finished: boolean;
	/** Whole-torrent completion, for the "still downloading (N%)" message. */
	percent: number;
}

const toResolved = (torrent: DebridLinkTorrent): DebridLinkResolvedRelease => ({
	torrent,
	files: debridLinkVideoFiles(Array.isArray(torrent.files) ? torrent.files : []),
	finished: isDlFinished(torrent.status),
	percent: typeof torrent.downloadPercent === 'number' ? torrent.downloadPercent : 0,
});

/**
 * Resolves a hash to its playable files with the caller's own credential.
 *
 * There is no non-mutating way to do this. `GET /seedbox/cached` was retired
 * (`400 endpointDisabled`) and nothing replaced it, so `POST /seedbox/add` is
 * both the resolve and the only cache probe Debrid-Link has left. The **full
 * magnet** goes over rather than a bare hash: a bare hash is only accepted when
 * the content is already cached, and a cast whose whole job is "make this
 * playable" should start the download rather than refuse.
 *
 * That spends one of the account's 50 daily torrents when the content is not
 * already there - the same bargain the search page's add button makes, and the
 * reason the cast routes report a quota refusal in words instead of a 500.
 *
 * Two measured behaviours make this safe to call more than once. The add is
 * **idempotent by hash** and the torrent id it returns is **stable** - a
 * bare-hash add, a magnet add, a duplicate add and even a re-add after removal
 * all answered with the same id - so a repeat costs one request and changes
 * nothing. And **nothing here removes anything afterwards**: because the add is
 * idempotent, an add on a torrent the caller already had is indistinguishable
 * from one that created it, and Debrid-Link's remove never fails (it echoes
 * back whatever id it was handed), so a cleanup would delete a user's own
 * seedbox item with no error signal at all. There is nothing to clean up
 * either - the links survive removal, and the id is stable.
 */
export const resolveDebridLinkRelease = async (
	token: string,
	hash: string
): Promise<DebridLinkResolvedRelease> => {
	const torrent = await addSeedboxTorrent(token, toMagnetUri(hash));
	return toResolved(torrent);
};

/**
 * Resolves a torrent the caller already holds, by its Debrid-Link id.
 *
 * Free where `resolveDebridLinkRelease` is not: no add, so no quota spent and
 * no flood risk on the add endpoint. This is also the ZIP escape hatch - a
 * torrent with many files lists as a single `isZip: true` row in the bulk
 * listing and only expands when fetched on its own.
 */
export const resolveDebridLinkTorrentById = async (
	token: string,
	torrentId: string
): Promise<DebridLinkResolvedRelease | null> => {
	const torrent = await getSeedboxTorrent(token, torrentId);
	return torrent ? toResolved(torrent) : null;
};

export const _testing = { deriveUserId };
