// The pre-HMAC availability token scheme, kept alive for exactly one release.
//
// This salt and hash used to live in `utils/token.ts`, which is imported by
// `pages/movie/[imdbid]`, `pages/show/[imdbid]/[seasonNum]` and
// `pages/hashlist.tsx` — so it shipped inside the browser bundle, where anyone
// could read it and mint a valid token offline. That made every endpoint
// "protected" by it effectively public, including the writes and deletes on the
// `Available` table.
//
// It lives here, server-side only, so that a browser still running the old
// cached bundle keeps working while it reloads. Nothing client-side imports this
// file. Delete it, and the legacy branch in `problemToken.ts`, next release.
const LEGACY_SALT = 'debridmediamanager.com%%fe7#td00rA3vHz%VmI';

const LEGACY_THRESHOLD_SECONDS = 300;

function legacyHash(str: string): string {
	let hash1 = 0xdeadbeef ^ str.length;
	let hash2 = 0x41c6ce57 ^ str.length;

	for (let i = 0; i < str.length; i++) {
		let charCode = str.charCodeAt(i);
		hash1 = Math.imul(hash1 ^ charCode, 2654435761);
		hash2 = Math.imul(hash2 ^ charCode, 1597334677);
		hash1 = (hash1 << 5) | (hash1 >>> 27); // Rotate left
		hash2 = (hash2 << 5) | (hash2 >>> 27); // Rotate left
	}

	hash1 = (hash1 + Math.imul(hash2, 1566083941)) | 0;
	hash2 = (hash2 + Math.imul(hash1, 2024237689)) | 0;

	return ((hash1 ^ hash2) >>> 0).toString(16);
}

function combineHashes(hash1: string, hash2: string): string {
	const halfLength = Math.floor(hash1.length / 2);
	const firstPart1 = hash1.slice(0, halfLength);
	const secondPart1 = hash1.slice(halfLength);
	const firstPart2 = hash2.slice(0, halfLength);
	const secondPart2 = hash2.slice(halfLength);

	let obfuscated = '';
	for (let i = 0; i < halfLength; i++) {
		obfuscated += firstPart1[i] + firstPart2[i];
	}

	obfuscated +=
		secondPart2.split('').reverse().join('') + secondPart1.split('').reverse().join('');

	return obfuscated;
}

/**
 * Validate a token minted by the old client-side scheme.
 *
 * Forgeable by design — the salt above is public. This exists only so the
 * changeover does not 403 a tab that loaded before the deploy.
 */
export function validateLegacyProblemToken(
	tokenWithTimestamp: string,
	receivedHash: string,
	now: number = Date.now()
): boolean {
	const [token, timestampStr] = tokenWithTimestamp.split('-');
	if (!token || !timestampStr) {
		return false;
	}

	const timestamp = parseInt(timestampStr, 10);
	if (!Number.isFinite(timestamp)) {
		return false;
	}

	const currentTimestamp = Math.floor(now / 1000);
	if (Math.abs(currentTimestamp - timestamp) > LEGACY_THRESHOLD_SECONDS) {
		return false;
	}

	const tokenTimestampHash = legacyHash(tokenWithTimestamp);
	const tokenSaltHash = legacyHash(`${LEGACY_SALT}-${token}`);
	return combineHashes(tokenTimestampHash, tokenSaltHash) === receivedHash;
}
