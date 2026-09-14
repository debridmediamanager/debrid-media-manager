import { repository as db } from '@/services/repository';
import { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSponsorRequest, requireSponsor, SPONSOR_HEADER } from './requireSponsor';
import { signSponsorToken, SPONSOR_TOKEN_TTL_SECONDS } from './sponsorToken';

vi.mock('@/services/repository');

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

function tokenFor({ keyVersion = 1, exp = Date.now() + SPONSOR_TOKEN_TTL_SECONDS * 1000 } = {}) {
	return signSponsorToken({
		shortId: 'ZP1M',
		githubUsername: 'sponsor',
		sources: ['patreon'],
		keyVersion,
		exp,
	});
}

/** What `getSponsorByShortId` answers for a row that is still paying. */
function activeLookup(keyVersion = 1) {
	return {
		isSponsor: true,
		sources: ['patreon' as const],
		shortId: 'ZP1M',
		githubUsername: 'sponsor',
		keyVersion,
	};
}

beforeEach(() => {
	process.env.DMM_SPONSOR_SECRET = 'test-sponsor-secret';
	vi.clearAllMocks();
	vi.mocked(db.getSponsorByShortId).mockResolvedValue(activeLookup());
});

afterEach(() => {
	delete process.env.DMM_SPONSOR_SECRET;
});

describe('requireSponsor', () => {
	it('returns the payload for a valid token on a live sponsorship', async () => {
		const res = mockRes();

		expect((await requireSponsor(reqWith(tokenFor()), res))?.shortId).toBe('ZP1M');
		expect(res.status).not.toHaveBeenCalled();
	});

	it('401s when the header is missing', async () => {
		const res = mockRes();
		expect(await requireSponsor(reqWith(), res)).toBeNull();
		expect(res.status).toHaveBeenCalledWith(401);
	});

	it('401s on a forged token', async () => {
		const res = mockRes();
		expect(await requireSponsor(reqWith('bogus.signature'), res)).toBeNull();
		expect(res.status).toHaveBeenCalledWith(401);
	});

	it('401s on an expired token', async () => {
		const res = mockRes();
		expect(await requireSponsor(reqWith(tokenFor({ exp: Date.now() - 1 })), res)).toBeNull();
		expect(res.status).toHaveBeenCalledWith(401);
	});

	// The regression. A token minted while the pledge was live stays signed and
	// unexpired for up to SPONSOR_TOKEN_TTL_SECONDS after gatekeeper's sync zeroes
	// the row, so trusting the signature alone kept every gated endpoint open for
	// a week after the sponsorship ended.
	it('401s once the sponsorship behind a still-valid token has lapsed', async () => {
		vi.mocked(db.getSponsorByShortId).mockResolvedValue({
			...activeLookup(),
			isSponsor: false,
			sources: [],
		});
		const res = mockRes();

		expect(await requireSponsor(reqWith(tokenFor()), res)).toBeNull();
		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.json).toHaveBeenCalledWith({ error: 'Sponsorship is no longer active' });
	});

	// Reset API Key bumps dmmApiKeyVersion, which has to kill the tokens minted
	// from the old key and not just the key itself.
	it('401s when the key version has moved on since the token was minted', async () => {
		vi.mocked(db.getSponsorByShortId).mockResolvedValue(activeLookup(2));
		const res = mockRes();

		expect(await requireSponsor(reqWith(tokenFor({ keyVersion: 1 })), res)).toBeNull();
		expect(res.status).toHaveBeenCalledWith(401);
	});

	it('401s when the sponsorship named by the token no longer exists', async () => {
		vi.mocked(db.getSponsorByShortId).mockResolvedValue(null);
		const res = mockRes();

		expect(await requireSponsor(reqWith(tokenFor()), res)).toBeNull();
		expect(res.status).toHaveBeenCalledWith(401);
	});

	// A lookup we could not perform is not a sponsorship that ended, and saying so
	// would send an active sponsor back to gatekeeper for a key that is already fine.
	it('503s rather than 401s when the sponsorship cannot be read', async () => {
		vi.mocked(db.getSponsorByShortId).mockRejectedValue(new Error('db down'));
		const res = mockRes();

		expect(await requireSponsor(reqWith(tokenFor()), res)).toBeNull();
		expect(res.status).toHaveBeenCalledWith(503);
	});
});

describe('isSponsorRequest', () => {
	it('is true for a valid token on a live sponsorship', async () => {
		expect(await isSponsorRequest(reqWith(tokenFor()))).toBe(true);
	});

	// These endpoints stay open to everyone, so a missing or bad token is a
	// non-sponsor rather than an error.
	it.each([
		['no header', undefined],
		['a forged token', 'forged.signature'],
	])('is false with %s, without erroring', async (_label, token) => {
		expect(await isSponsorRequest(reqWith(token))).toBe(false);
	});

	// Same regression as above, on the soft gate: a lapsed sponsor kept the raised
	// stream ceiling and the priority tier until their token expired.
	it('is false once the sponsorship behind a still-valid token has lapsed', async () => {
		vi.mocked(db.getSponsorByShortId).mockResolvedValue({
			...activeLookup(),
			isSponsor: false,
			sources: [],
		});

		expect(await isSponsorRequest(reqWith(tokenFor()))).toBe(false);
	});

	it('is false when the key version has moved on since the token was minted', async () => {
		vi.mocked(db.getSponsorByShortId).mockResolvedValue(activeLookup(2));

		expect(await isSponsorRequest(reqWith(tokenFor({ keyVersion: 1 })))).toBe(false);
	});

	// These callers were only widening a limit. An unreadable sponsorship has to
	// leave them serving the ordinary ceiling, never throw a 500 out of them.
	it('is false rather than throwing when the sponsorship cannot be read', async () => {
		vi.mocked(db.getSponsorByShortId).mockRejectedValue(new Error('db down'));

		expect(await isSponsorRequest(reqWith(tokenFor()))).toBe(false);
	});
});

// Next always supplies `headers`, but hand-built request objects in tests and
// any caller that forgets it must read as a non-sponsor, not throw a 500 out of
// an endpoint that was only widening a limit.
describe('a request with no headers object', () => {
	it('isSponsorRequest returns false rather than throwing', async () => {
		expect(await isSponsorRequest({} as unknown as NextApiRequest)).toBe(false);
	});

	it('requireSponsor 401s rather than throwing', async () => {
		const res = mockRes();
		expect(await requireSponsor({} as unknown as NextApiRequest, res)).toBeNull();
		expect(res.status).toHaveBeenCalledWith(401);
	});

	// Neither gate may reach the database before the token itself checks out.
	it('never looks the sponsorship up', async () => {
		await isSponsorRequest(reqWith());
		const res = mockRes();
		await requireSponsor(reqWith('forged.signature'), res);

		expect(db.getSponsorByShortId).not.toHaveBeenCalled();
	});
});
