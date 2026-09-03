// Opaque release ids for the Newznab aggregation endpoint.
//
// A release id has to travel to the client and come back, but the native id it
// wraps names the upstream indexer that produced it — and an upstream's own
// ids, paired with the prefix, are enough to reconstruct which paid accounts
// DMM fans out to. So the id is encrypted rather than encoded, and the key
// never leaves the server.
//
// Encryption is deterministic (an SIV construction: the IV is a MAC of the
// plaintext, not a random value). That is REQUIRED, not a convenience — the
// token is the RSS `<guid>`, and every *arr dedupes grabs by guid across syncs.
// A random IV would mint a fresh guid every sync, so each release would look
// new every few minutes and be grabbed again.
//
// The cost of determinism is the usual one for SIV: identical plaintexts
// produce identical tokens, so an observer can tell that two feeds carry the
// same release. That is already obvious from the titles, so nothing leaks.

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, timingSafeEqual } from 'crypto';

/** AES-GCM's nonce length. 12 bytes is the only size GCM accepts natively. */
const IV_LENGTH = 12;
/** AES-GCM's authentication tag length. */
const TAG_LENGTH = 16;
/** 32 bytes of key material, hex-encoded. */
const SECRET_PATTERN = /^[0-9a-fA-F]{64}$/;

// Distinct `info` strings, so the encryption key and the IV key are independent
// outputs of the same secret. Reusing one key for both would let the IV — which
// is public, it is the first 12 bytes of the token — be a MAC under the same
// key that encrypts, which is exactly what SIV avoids.
const ENCRYPTION_KEY_INFO = 'dmm-newznab-release-id-encryption-v1';
const IV_KEY_INFO = 'dmm-newznab-release-id-iv-v1';

interface DerivedKeys {
	encryptionKey: Buffer;
	ivKey: Buffer;
}

let derivedKeys: DerivedKeys | null = null;
let warnedAboutMissingSecret = false;

/**
 * Derives (and memoizes) the two keys. Returns null when the secret is unset or
 * malformed — fail closed, so a deploy that forgot the env var serves an error
 * rather than tokens signed with a placeholder.
 *
 * The env var is read here rather than at module scope: Next.js evaluates a
 * module before the runtime env is in place on some deploy paths.
 */
function getDerivedKeys(): DerivedKeys | null {
	if (derivedKeys) return derivedKeys;

	const secret = process.env.NEWZNAB_TOKEN_SECRET;
	if (!secret || !SECRET_PATTERN.test(secret)) {
		if (!warnedAboutMissingSecret) {
			warnedAboutMissingSecret = true;
			console.error(
				'NEWZNAB_TOKEN_SECRET is unset or not 64 hex characters — the Newznab endpoint will refuse every request'
			);
		}
		return null;
	}

	const ikm = Buffer.from(secret, 'hex');
	// No salt: the secret is already a full-entropy 256-bit key, so HKDF is doing
	// domain separation here rather than entropy extraction.
	const salt = Buffer.alloc(0);
	derivedKeys = {
		encryptionKey: Buffer.from(hkdfSync('sha256', ikm, salt, ENCRYPTION_KEY_INFO, 32)),
		ivKey: Buffer.from(hkdfSync('sha256', ikm, salt, IV_KEY_INFO, 32)),
	};
	return derivedKeys;
}

/**
 * Whether a usable secret is configured. Callers gate on this and answer
 * newznab error 910 when it is false, because `encryptReleaseId` throws without
 * one.
 */
export function hasTokenSecret(): boolean {
	return getDerivedKeys() !== null;
}

function deriveIv(ivKey: Buffer, plaintext: Buffer): Buffer {
	return createHmac('sha256', ivKey).update(plaintext).digest().subarray(0, IV_LENGTH);
}

/**
 * Wraps `prefix` and the upstream's native id into one opaque token.
 *
 * Throws when no secret is configured; every caller checks `hasTokenSecret()`
 * first and answers 910, so this never surfaces to a client.
 */
export function encryptReleaseId(prefix: string, nativeId: string): string {
	const keys = getDerivedKeys();
	if (!keys) {
		throw new Error('NEWZNAB_TOKEN_SECRET is unset or malformed');
	}

	// `\n` is the separator because a prefix never contains one and splitting on
	// the first occurrence leaves any newline in the native id intact.
	const plaintext = Buffer.from(`${prefix}\n${nativeId}`, 'utf8');
	const iv = deriveIv(keys.ivKey, plaintext);
	const cipher = createCipheriv('aes-256-gcm', keys.encryptionKey, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64url');
}

/**
 * Unwraps a token, or returns null when it is missing, truncated, forged or
 * minted under a different secret. Never throws: this runs on a query parameter
 * a stranger controls.
 */
export function decryptReleaseId(token: string): { prefix: string; nativeId: string } | null {
	if (typeof token !== 'string' || !token) return null;

	const keys = getDerivedKeys();
	if (!keys) return null;

	const raw = Buffer.from(token, 'base64url');
	// The shortest legal plaintext is a one-character prefix and a one-character
	// id, so there is always at least three bytes of ciphertext.
	if (raw.length <= IV_LENGTH + TAG_LENGTH) return null;

	const iv = raw.subarray(0, IV_LENGTH);
	const ciphertext = raw.subarray(IV_LENGTH, raw.length - TAG_LENGTH);
	const tag = raw.subarray(raw.length - TAG_LENGTH);

	let plaintext: Buffer;
	try {
		const decipher = createDecipheriv('aes-256-gcm', keys.encryptionKey, iv);
		decipher.setAuthTag(tag);
		plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
	} catch {
		// GCM tag mismatch, or an IV the cipher would not accept.
		return null;
	}

	// Re-derive the IV and insist it matches. The GCM tag already proves nobody
	// without the key built this token; this proves the token is the *canonical*
	// one for its plaintext, which is what makes the guid stable — two tokens
	// decrypting to one release would be grabbed twice.
	const expectedIv = deriveIv(keys.ivKey, plaintext);
	if (iv.length !== expectedIv.length || !timingSafeEqual(iv, expectedIv)) return null;

	const text = plaintext.toString('utf8');
	const separator = text.indexOf('\n');
	if (separator <= 0) return null;

	const prefix = text.slice(0, separator);
	const nativeId = text.slice(separator + 1);
	if (!nativeId) return null;

	return { prefix, nativeId };
}

/**
 * Clears the memoized keys so a test can swap `NEWZNAB_TOKEN_SECRET`. Tests
 * only — in production the secret is fixed for the life of the process.
 */
export function _resetTokenSecretForTest(): void {
	derivedKeys = null;
	warnedAboutMissingSecret = false;
}
