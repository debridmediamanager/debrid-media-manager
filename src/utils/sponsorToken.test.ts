import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	SPONSOR_TOKEN_TTL_SECONDS,
	signSponsorToken,
	verifySponsorToken,
	type SponsorTokenPayload,
} from './sponsorToken';

const SECRET = 'test-sponsor-secret';

function payload(overrides: Partial<SponsorTokenPayload> = {}): SponsorTokenPayload {
	return {
		shortId: 'ZP1M',
		githubUsername: 'sponsor',
		sources: ['github'],
		keyVersion: 1,
		exp: Date.now() + SPONSOR_TOKEN_TTL_SECONDS * 1000,
		...overrides,
	};
}

describe('sponsorToken', () => {
	beforeEach(() => {
		process.env.DMM_SPONSOR_SECRET = SECRET;
	});

	afterEach(() => {
		delete process.env.DMM_SPONSOR_SECRET;
	});

	it('round-trips a payload', () => {
		const verified = verifySponsorToken(signSponsorToken(payload()));
		expect(verified?.shortId).toBe('ZP1M');
		expect(verified?.sources).toEqual(['github']);
	});

	it('rejects a payload edited in place', () => {
		const token = signSponsorToken(payload({ sources: [] }));
		const [body, signature] = token.split('.');
		const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
		claims.sources = ['github'];
		const forged = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;

		expect(verifySponsorToken(forged)).toBeNull();
	});

	it('rejects a token signed with a different secret', () => {
		const token = signSponsorToken(payload());
		process.env.DMM_SPONSOR_SECRET = 'someone-elses-secret';
		expect(verifySponsorToken(token)).toBeNull();
	});

	it('rejects an expired token', () => {
		expect(verifySponsorToken(signSponsorToken(payload({ exp: Date.now() - 1 })))).toBeNull();
	});

	it('rejects malformed input', () => {
		expect(verifySponsorToken(undefined)).toBeNull();
		expect(verifySponsorToken('')).toBeNull();
		expect(verifySponsorToken('no-separator')).toBeNull();
		expect(verifySponsorToken('.onlysignature')).toBeNull();
		expect(verifySponsorToken('onlybody.')).toBeNull();
	});

	// Fails closed: a missing secret must make everyone a non-sponsor, never
	// everyone a sponsor.
	it('verifies nothing when the secret is unset', () => {
		const token = signSponsorToken(payload());
		delete process.env.DMM_SPONSOR_SECRET;
		expect(verifySponsorToken(token)).toBeNull();
	});

	it('refuses to sign without a secret', () => {
		delete process.env.DMM_SPONSOR_SECRET;
		expect(() => signSponsorToken(payload())).toThrow(/DMM_SPONSOR_SECRET/);
	});
});
