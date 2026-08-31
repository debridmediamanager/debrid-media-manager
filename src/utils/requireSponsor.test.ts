import { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSponsorRequest, requireSponsor, SPONSOR_HEADER } from './requireSponsor';
import { signSponsorToken, SPONSOR_TOKEN_TTL_SECONDS } from './sponsorToken';

function mockRes() {
	const res = {
		status: vi.fn().mockReturnThis(),
		json: vi.fn().mockReturnThis(),
	};
	return res as unknown as NextApiResponse & typeof res;
}

function reqWith(token?: string): NextApiRequest {
	return { headers: token ? { [SPONSOR_HEADER]: token } : {} } as unknown as NextApiRequest;
}

describe('requireSponsor', () => {
	beforeEach(() => {
		process.env.DMM_SPONSOR_SECRET = 'test-sponsor-secret';
	});

	afterEach(() => {
		delete process.env.DMM_SPONSOR_SECRET;
	});

	it('returns the payload for a valid token', () => {
		const token = signSponsorToken({
			shortId: 'ZP1M',
			githubUsername: 'sponsor',
			sources: ['patreon'],
			keyVersion: 1,
			exp: Date.now() + SPONSOR_TOKEN_TTL_SECONDS * 1000,
		});
		const res = mockRes();

		expect(requireSponsor(reqWith(token), res)?.shortId).toBe('ZP1M');
		expect(res.status).not.toHaveBeenCalled();
	});

	it('401s when the header is missing', () => {
		const res = mockRes();
		expect(requireSponsor(reqWith(), res)).toBeNull();
		expect(res.status).toHaveBeenCalledWith(401);
	});

	it('401s on a forged token', () => {
		const res = mockRes();
		expect(requireSponsor(reqWith('bogus.signature'), res)).toBeNull();
		expect(res.status).toHaveBeenCalledWith(401);
	});

	it('401s on an expired token', () => {
		const token = signSponsorToken({
			shortId: 'ZP1M',
			githubUsername: 'sponsor',
			sources: ['github'],
			keyVersion: 1,
			exp: Date.now() - 1,
		});
		const res = mockRes();
		expect(requireSponsor(reqWith(token), res)).toBeNull();
		expect(res.status).toHaveBeenCalledWith(401);
	});
});

describe('isSponsorRequest', () => {
	beforeEach(() => {
		process.env.DMM_SPONSOR_SECRET = 'test-sponsor-secret';
	});

	afterEach(() => {
		delete process.env.DMM_SPONSOR_SECRET;
	});

	const valid = () =>
		signSponsorToken({
			shortId: 'ZP1M',
			githubUsername: 'someone',
			sources: ['github'],
			keyVersion: 1,
			exp: Date.now() + SPONSOR_TOKEN_TTL_SECONDS * 1000,
		});

	it('is true for a valid token', () => {
		expect(isSponsorRequest(reqWith(valid()))).toBe(true);
	});

	// These endpoints stay open to everyone, so a missing or bad token is a
	// non-sponsor rather than an error.
	it.each([
		['no header', undefined],
		['a forged token', 'forged.signature'],
	])('is false with %s, without erroring', (_label, token) => {
		expect(isSponsorRequest(reqWith(token))).toBe(false);
	});
});

// Next always supplies `headers`, but hand-built request objects in tests and
// any caller that forgets it must read as a non-sponsor, not throw a 500 out of
// an endpoint that was only widening a limit.
describe('a request with no headers object', () => {
	it('isSponsorRequest returns false rather than throwing', () => {
		expect(isSponsorRequest({} as unknown as NextApiRequest)).toBe(false);
	});

	it('requireSponsor 401s rather than throwing', () => {
		const res = mockRes();
		expect(requireSponsor({} as unknown as NextApiRequest, res)).toBeNull();
		expect(res.status).toHaveBeenCalledWith(401);
	});
});
