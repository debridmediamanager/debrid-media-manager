import {
	_resetTokenSecretForTest,
	decryptReleaseId,
	encryptReleaseId,
	hasTokenSecret,
} from '@/services/newznab/opaqueId';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SECRET = '0123456789abcdef'.repeat(4); // 64 hex chars = 32 bytes
const OTHER_SECRET = 'fedcba9876543210'.repeat(4);

const originalSecret = process.env.NEWZNAB_TOKEN_SECRET;

function setSecret(secret: string | undefined): void {
	if (secret === undefined) {
		delete process.env.NEWZNAB_TOKEN_SECRET;
	} else {
		process.env.NEWZNAB_TOKEN_SECRET = secret;
	}
	_resetTokenSecretForTest();
}

beforeEach(() => {
	setSecret(SECRET);
});

afterEach(() => {
	setSecret(originalSecret);
});

describe('encryptReleaseId / decryptReleaseId', () => {
	it('round-trips a prefix and native id', () => {
		const token = encryptReleaseId('ds', 'abc123');
		expect(decryptReleaseId(token)).toEqual({ prefix: 'ds', nativeId: 'abc123' });
	});

	it('round-trips ids carrying separators and unicode', () => {
		const nativeId = 'a:b/c+d=e fé—';
		const token = encryptReleaseId('tm-de', nativeId);
		expect(decryptReleaseId(token)).toEqual({ prefix: 'tm-de', nativeId });
	});

	it('produces a URL-safe token', () => {
		const token = encryptReleaseId('ds', 'abc123');
		expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it('is deterministic — the same input yields an identical token', () => {
		// The token is the RSS guid and *arrs dedupe grabs by guid, so a token
		// that changed between syncs would re-grab every release.
		expect(encryptReleaseId('ds', 'abc123')).toBe(encryptReleaseId('ds', 'abc123'));
	});

	it('produces different tokens for different releases', () => {
		expect(encryptReleaseId('ds', 'abc123')).not.toBe(encryptReleaseId('ds', 'abc124'));
		expect(encryptReleaseId('ds', 'abc123')).not.toBe(encryptReleaseId('ah', 'abc123'));
	});

	it('returns null when a ciphertext byte is flipped', () => {
		const token = encryptReleaseId('ds', 'abc123');
		const raw = Buffer.from(token, 'base64url');
		// Byte 14 sits inside the ciphertext (IV is bytes 0-11).
		raw[14] ^= 0xff;
		expect(decryptReleaseId(raw.toString('base64url'))).toBeNull();
	});

	it('returns null when an IV byte is flipped', () => {
		const token = encryptReleaseId('ds', 'abc123');
		const raw = Buffer.from(token, 'base64url');
		raw[0] ^= 0xff;
		expect(decryptReleaseId(raw.toString('base64url'))).toBeNull();
	});

	it('returns null when the auth tag is flipped', () => {
		const token = encryptReleaseId('ds', 'abc123');
		const raw = Buffer.from(token, 'base64url');
		raw[raw.length - 1] ^= 0xff;
		expect(decryptReleaseId(raw.toString('base64url'))).toBeNull();
	});

	it('returns null for garbage, empty and truncated tokens', () => {
		expect(decryptReleaseId('')).toBeNull();
		expect(decryptReleaseId('not-a-real-token')).toBeNull();
		expect(decryptReleaseId('!!!!')).toBeNull();
		const token = encryptReleaseId('ds', 'abc123');
		expect(decryptReleaseId(token.slice(0, 8))).toBeNull();
	});

	it('returns null for a token minted under a different secret', () => {
		const token = encryptReleaseId('ds', 'abc123');
		setSecret(OTHER_SECRET);
		expect(decryptReleaseId(token)).toBeNull();
	});
});

describe('hasTokenSecret', () => {
	it('is true for a 64-hex-character secret', () => {
		expect(hasTokenSecret()).toBe(true);
	});

	it('is false when the secret is unset', () => {
		setSecret(undefined);
		expect(hasTokenSecret()).toBe(false);
	});

	it('is false when the secret is not 64 hex characters', () => {
		setSecret('too-short');
		expect(hasTokenSecret()).toBe(false);

		setSecret('z'.repeat(64));
		expect(hasTokenSecret()).toBe(false);
	});

	it('gates encryption — without a secret decrypt is null and encrypt throws', () => {
		setSecret(undefined);
		expect(decryptReleaseId('anything')).toBeNull();
		expect(() => encryptReleaseId('ds', 'abc123')).toThrow(/NEWZNAB_TOKEN_SECRET/);
	});
});
