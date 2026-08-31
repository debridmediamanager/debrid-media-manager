import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProblemSecret, mintProblemToken, validateProblemToken } from './problemToken';

const SECRET = 'test-problem-secret-0123456789';

// The salt that used to ship inside the browser bundle. Anything derivable from
// it must not be enough to mint a token once the changeover completes.
const LEAKED_SALT = 'debridmediamanager.com%%fe7#td00rA3vHz%VmI';

function legacyHash(str: string): string {
	let hash1 = 0xdeadbeef ^ str.length;
	let hash2 = 0x41c6ce57 ^ str.length;
	for (let i = 0; i < str.length; i++) {
		const charCode = str.charCodeAt(i);
		hash1 = Math.imul(hash1 ^ charCode, 2654435761);
		hash2 = Math.imul(hash2 ^ charCode, 1597334677);
		hash1 = (hash1 << 5) | (hash1 >>> 27);
		hash2 = (hash2 << 5) | (hash2 >>> 27);
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
	return (
		obfuscated +
		secondPart2.split('').reverse().join('') +
		secondPart1.split('').reverse().join('')
	);
}

/** Mint a token the way an attacker with the leaked client bundle would. */
function forgeWithLeakedSalt(now: number): [string, string] {
	const token = `deadbeef-${Math.floor(now / 1000)}`;
	const [nonce] = token.split('-');
	return [token, combineHashes(legacyHash(token), legacyHash(`${LEAKED_SALT}-${nonce}`))];
}

describe('problemToken', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv, DMM_PROBLEM_SECRET: SECRET };
	});

	afterEach(() => {
		process.env = originalEnv;
		vi.useRealTimers();
	});

	describe('getProblemSecret', () => {
		it('returns the configured secret', () => {
			expect(getProblemSecret()).toBe(SECRET);
		});

		it('treats an empty secret as absent', () => {
			process.env.DMM_PROBLEM_SECRET = '';
			expect(getProblemSecret()).toBeUndefined();
		});
	});

	describe('mintProblemToken', () => {
		it('mints a pair that validates', () => {
			const now = 1_800_000_000_000;
			const [token, hash] = mintProblemToken(SECRET, now);
			expect(validateProblemToken(token, hash, now)).toBe(true);
		});

		it('embeds the minting second so freshness is checkable', () => {
			const now = 1_800_000_000_000;
			const [token] = mintProblemToken(SECRET, now);
			expect(token.endsWith(`-${Math.floor(now / 1000)}`)).toBe(true);
		});

		it('never repeats a nonce', () => {
			const now = 1_800_000_000_000;
			const first = mintProblemToken(SECRET, now)[0];
			const second = mintProblemToken(SECRET, now)[0];
			expect(first).not.toBe(second);
		});
	});

	describe('validateProblemToken', () => {
		const now = 1_800_000_000_000;

		it('rejects a tampered signature', () => {
			const [token] = mintProblemToken(SECRET, now);
			expect(validateProblemToken(token, 'deadbeef', now)).toBe(false);
		});

		it('rejects a signature minted under a different secret', () => {
			const [token, hash] = mintProblemToken('some-other-secret', now);
			expect(validateProblemToken(token, hash, now)).toBe(false);
		});

		it('rejects a token past its 5-minute window', () => {
			const [token, hash] = mintProblemToken(SECRET, now);
			expect(validateProblemToken(token, hash, now + 301_000)).toBe(false);
		});

		it('accepts a token inside its 5-minute window', () => {
			const [token, hash] = mintProblemToken(SECRET, now);
			expect(validateProblemToken(token, hash, now + 299_000)).toBe(true);
		});

		it('rejects a token from the future beyond the window', () => {
			const [token, hash] = mintProblemToken(SECRET, now + 400_000);
			expect(validateProblemToken(token, hash, now)).toBe(false);
		});

		it.each([
			['missing token', undefined, 'abc'],
			['missing hash', 'abc-123', undefined],
			['non-string token', 42, 'abc'],
			['non-string hash', 'abc-123', 42],
			['empty token', '', 'abc'],
			['empty hash', 'abc-123', ''],
			['token with no timestamp', 'abc', 'abc'],
		])('rejects %s', (_label, token, hash) => {
			expect(validateProblemToken(token, hash, now)).toBe(false);
		});

		it('does not throw when the secret is unset', () => {
			delete process.env.DMM_PROBLEM_SECRET;
			const [token, hash] = mintProblemToken(SECRET, now);
			expect(validateProblemToken(token, hash, now)).toBe(false);
		});
	});

	// The salt below was readable in every visitor's JS bundle, so this is the
	// forgery anyone could produce offline. The one-release grace period that
	// accepted it ended 2026-08-31; it must now be refused outright.
	describe('the leaked-salt forgery this change exists to stop', () => {
		const now = 1_800_000_000_000;

		it('is refused', () => {
			const [token, hash] = forgeWithLeakedSalt(now);
			expect(validateProblemToken(token, hash, now)).toBe(false);
		});

		it('is still refused when the timestamp is fresh and well-formed', () => {
			const [token, hash] = forgeWithLeakedSalt(Date.now());
			expect(validateProblemToken(token, hash)).toBe(false);
		});

		it('does not stop a properly minted token from working', () => {
			const [token, hash] = mintProblemToken(SECRET, now);
			expect(validateProblemToken(token, hash, now)).toBe(true);
		});
	});
});
