import { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireSponsor, SPONSOR_HEADER } from './requireSponsor';
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
