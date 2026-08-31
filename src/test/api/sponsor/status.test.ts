import handler from '@/pages/api/sponsor/status';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { signSponsorToken, verifySponsorToken } from '@/utils/sponsorToken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');

const ACTIVE = {
	isSponsor: true,
	sources: ['github' as const],
	shortId: 'ZP1M',
	githubUsername: 'someone',
	keyVersion: 1,
};

function token(keyVersion = 1) {
	return signSponsorToken({
		shortId: 'ZP1M',
		githubUsername: 'someone',
		sources: ['github'],
		keyVersion,
		exp: Date.now() + 3_600_000,
	});
}

function request(t?: string) {
	return createMockRequest({ headers: t ? { 'x-dmm-sponsor': t } : {} });
}

describe('GET /api/sponsor/status', () => {
	beforeEach(() => {
		process.env.DMM_SPONSOR_SECRET = 'test-sponsor-secret';
		vi.mocked(repository.getSponsorByShortId).mockReset();
	});

	afterEach(() => {
		delete process.env.DMM_SPONSOR_SECRET;
	});

	it('401s without a token', async () => {
		const res = createMockResponse();
		await handler(request(), res);
		expect(res._getStatusCode()).toBe(401);
		expect(repository.getSponsorByShortId).not.toHaveBeenCalled();
	});

	it('401s a forged token', async () => {
		const res = createMockResponse();
		await handler(request('forged.signature'), res);
		expect(res._getStatusCode()).toBe(401);
	});

	it('re-issues a token for a still-active sponsor', async () => {
		vi.mocked(repository.getSponsorByShortId).mockResolvedValue(ACTIVE);
		const res = createMockResponse();
		await handler(request(token()), res);

		const body = res._getData() as { isSponsor: boolean; token: string };
		expect(body.isSponsor).toBe(true);
		expect(verifySponsorToken(body.token)?.shortId).toBe('ZP1M');
	});

	// The live row is the authority, not the token: this is the only place a
	// sponsorship that lapsed mid-token is noticed.
	it('reports a lapsed sponsorship even though the token still verifies', async () => {
		vi.mocked(repository.getSponsorByShortId).mockResolvedValue({
			...ACTIVE,
			isSponsor: false,
			sources: [],
		});
		const res = createMockResponse();
		await handler(request(token()), res);
		expect(res._getData()).toEqual({ isSponsor: false, sources: [] });
	});

	// Reset API Key in gatekeeper bumps dmmApiKeyVersion. Without this check it
	// would revoke the key but leave every token already minted from it working.
	it('rejects a token minted before a key reset', async () => {
		vi.mocked(repository.getSponsorByShortId).mockResolvedValue({ ...ACTIVE, keyVersion: 2 });
		const res = createMockResponse();
		await handler(request(token(1)), res);
		expect(res._getData()).toEqual({ isSponsor: false, sources: [] });
	});

	it('reports a sponsor whose row has vanished', async () => {
		vi.mocked(repository.getSponsorByShortId).mockResolvedValue(null);
		const res = createMockResponse();
		await handler(request(token()), res);
		expect(res._getData()).toEqual({ isSponsor: false, sources: [] });
	});
});
