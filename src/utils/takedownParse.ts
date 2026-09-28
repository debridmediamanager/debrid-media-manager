/**
 * Turns what a claimant pastes into the things DMM can block. The uploaders
 * (debrid, nzb2rd, rd-uploader) implement normalizeReleaseName byte for byte:
 * change it here and there together, or a blocked release reaches them under a
 * name they do not recognise.
 */
export const normalizeReleaseName = (name: string): string =>
	name
		.toLowerCase()
		.replace(/\.nzb$/, '')
		.replace(/[^a-z0-9]+/g, '.')
		.replace(/^\.+|\.+$/g, '');

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** A magnet may carry its BTIH as 32 base32 characters instead of 40 hex. */
export const base32ToHex = (input: string): string | null => {
	const s = input.toLowerCase();
	if (!/^[a-z2-7]{32}$/.test(s)) return null;
	let bits = '';
	for (const c of s) bits += BASE32.indexOf(c).toString(2).padStart(5, '0');
	let hex = '';
	for (let i = 0; i < 160; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
	return hex;
};

// Word boundaries alone would take 40 hex characters out of a longer hex run,
// such as a SHA-256, and block an unrelated torrent.
const HEX_HASH = /(?<![0-9a-f])[0-9a-f]{40}(?![0-9a-f])/gi;
const MAGNET_BASE32 = /urn:btih:([a-z2-7]{32})(?![a-z2-7])/gi;
const HASHLIST_URL =
	/hashlists\.debridmediamanager\.com\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

export const MAX_NOTICE_ITEMS = 5000;

export type ParsedLocations = {
	hashes: string[];
	releases: string[];
	hashlistIds: string[];
};

export const parseNoticeLocations = (locations: string, releaseNames: string): ParsedLocations => {
	const hashes = new Set<string>();
	for (const match of locations.matchAll(HEX_HASH)) hashes.add(match[0].toLowerCase());
	for (const match of locations.matchAll(MAGNET_BASE32)) {
		const hex = base32ToHex(match[1]);
		if (hex) hashes.add(hex);
	}

	const hashlistIds = new Set<string>();
	for (const match of locations.matchAll(HASHLIST_URL)) hashlistIds.add(match[1].toLowerCase());

	const releases = new Set<string>();
	for (const line of releaseNames.split(/\r?\n/)) {
		const name = normalizeReleaseName(line.trim());
		// A bare word ("movie") would block every release sharing it once
		// normalized; a release name has at least a title and a tag.
		if (name.includes('.') && name.length <= 191) releases.add(name);
	}

	return {
		hashes: [...hashes],
		releases: [...releases],
		hashlistIds: [...hashlistIds],
	};
};
