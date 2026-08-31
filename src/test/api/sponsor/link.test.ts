import handler from '@/pages/api/sponsor/link';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { verifySponsorToken } from '@/utils/sponsorToken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');

const KEY = 'a'.repeat(64);

const ACTIVE = {
	isSponsor: true,
	sources: ['patreon' as const],
	shortId: 'ZP1M',
	githubUsername: 'someone',
	keyVersion: 1,
};

function request(body: Record<string, unknown> = { apiKey: KEY }) {
	return createMockRequest({ method: 'POST', body });
}

describe('POST /api/sponsor/link', () => {
	beforeEach(() => {
		process.env.DMM_SPONSOR_SECRET = 'test-sponsor-secret';
		vi.mocked(repository.getSponsorByDmmApiKey).mockReset();
	});

	afterEach(() => {
		delete process.env.DMM_SPONSOR_SECRET;
	});

	it('rejects a non-POST method', async () => {
		const res = createMockResponse();
		await handler(createMockRequest({ method: 'GET' }), res);
		expect(res._getStatusCode()).toBe(405);
	});

	it('rejects a missing key without hitting the database', async () => {
		const res = createMockResponse();
		await handler(request({}), res);
		expect(res._getStatusCode()).toBe(400);
		expect(repository.getSponsorByDmmApiKey).not.toHaveBeenCalled();
	});

	it('mints a verifiable token for an active sponsor', async () => {
		vi.mocked(repository.getSponsorByDmmApiKey).mockResolvedValue(ACTIVE);
		const res = createMockResponse();
		await handler(request(), res);

		expect(res._getStatusCode()).toBe(200);
		const body = res._getData() as { isSponsor: boolean; token: string };
		expect(body.isSponsor).toBe(true);

		const verified = verifySponsorToken(body.token);
		expect(verified?.shortId).toBe('ZP1M');
		expect(verified?.sources).toEqual(['patreon']);
		expect(verified?.keyVersion).toBe(1);
	});

	it('trims a pasted key before looking it up', async () => {
		vi.mocked(repository.getSponsorByDmmApiKey).mockResolvedValue(ACTIVE);
		await handler(request({ apiKey: `  ${KEY}\n` }), createMockResponse());
		expect(repository.getSponsorByDmmApiKey).toHaveBeenCalledWith(KEY);
	});

	it('404s an unknown key', async () => {
		vi.mocked(repository.getSponsorByDmmApiKey).mockResolvedValue(null);
		const res = createMockResponse();
		await handler(request(), res);
		expect(res._getStatusCode()).toBe(404);
		expect((res._getData() as { isSponsor: boolean }).isSponsor).toBe(false);
	});

	// A real key whose sponsorship has ended must not mint a token, and the
	// sponsor deserves to be told which of the two happened.
	it('issues no token for a real key behind a lapsed sponsorship', async () => {
		vi.mocked(repository.getSponsorByDmmApiKey).mockResolvedValue({
			...ACTIVE,
			isSponsor: false,
			sources: [],
		});
		const res = createMockResponse();
		await handler(request(), res);

		const body = res._getData() as { isSponsor: boolean; token?: string; error: string };
		expect(res._getStatusCode()).toBe(200);
		expect(body.isSponsor).toBe(false);
		expect(body.token).toBeUndefined();
		expect(body.error).toMatch(/no longer active/);
	});
});
