import handler from '@/pages/api/usenet/dead';
import { _resetTokenSecretForTest, encryptReleaseId } from '@/services/newznab/opaqueId';
import { checkRateLimitFor } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>()),
	checkRateLimitFor: vi.fn(),
}));

const mockRepo = vi.mocked(repository);
const SECRET = 's3cret';
const SPONSOR_KEY = 'c'.repeat(64);
const NZB2RD = { authorization: `Bearer ${SECRET}` };
const ZURG = { 'x-api-key': SPONSOR_KEY };

const post = async (body: unknown, headers: Record<string, string> = NZB2RD, method = 'POST') => {
	const res = createMockResponse();
	await handler(createMockRequest({ method, headers, body }), res);
	return res;
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv('METADATA_API_SECRET', SECRET);
	vi.stubEnv('NEWZNAB_TOKEN_SECRET', 'a'.repeat(64));
	_resetTokenSecretForTest();
	vi.mocked(checkRateLimitFor).mockResolvedValue(true);
	mockRepo.recordUsenetDead = vi.fn().mockResolvedValue(undefined);
	mockRepo.getSponsorByDmmApiKey = vi.fn(async (key: string) =>
		key === SPONSOR_KEY
			? {
					isSponsor: true,
					sources: ['github' as const],
					shortId: 'ZP1M',
					githubUsername: 'someone',
					keyVersion: 1,
				}
			: null
	);
});
afterEach(() => {
	vi.unstubAllEnvs();
	_resetTokenSecretForTest();
});

describe('POST /api/usenet/dead', () => {
	it('marks the postings nzb2rd reports, by id or by grab token', async () => {
		const res = await post({ ids: ['ds:ABC123', encryptReleaseId('ah', 'b12393c9')] });

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res._getData()).toEqual({ marked: 2 });
		expect(mockRepo.recordUsenetDead).toHaveBeenCalledWith(
			['ds:abc123', 'ah:b12393c9'],
			'nzb2rd'
		);
		expect(checkRateLimitFor).toHaveBeenCalledWith(
			'internal',
			expect.objectContaining({ name: 'usenetDead' }),
			res
		);
	});

	it("takes a sponsor's zurg report, on that sponsor's budget", async () => {
		const res = await post({ ids: ['en:087f6a3ae880ec5d81efc65e065067ec084adc52df8a5'] }, ZURG);

		expect(res._getData()).toEqual({ marked: 1 });
		expect(mockRepo.recordUsenetDead).toHaveBeenCalledWith(
			['en:087f6a3ae880ec5d81efc65e065067ec084adc52df8a5'],
			'zurg'
		);
		expect(checkRateLimitFor).toHaveBeenCalledWith(
			'sponsor:ZP1M',
			expect.objectContaining({ name: 'usenetDead' }),
			res
		);
	});

	it('counts a posting named twice once', async () => {
		const res = await post({ ids: ['ds:a', 'DS:A', encryptReleaseId('ds', 'a')] });

		expect(res._getData()).toEqual({ marked: 1 });
		expect(mockRepo.recordUsenetDead).toHaveBeenCalledWith(['ds:a'], 'nzb2rd');
	});

	it.each([
		['no credentials', {}],
		['a wrong secret', { authorization: 'Bearer wrong' }],
		['an unknown key', { 'x-api-key': 'd'.repeat(64) }],
	])('refuses %s', async (_label, headers) => {
		const res = await post({ ids: ['ds:a'] }, headers);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(mockRepo.recordUsenetDead).not.toHaveBeenCalled();
	});

	it('refuses a lapsed sponsorship', async () => {
		mockRepo.getSponsorByDmmApiKey = vi.fn().mockResolvedValue({
			isSponsor: false,
			sources: [],
			shortId: 'ZP1M',
			githubUsername: 'someone',
			keyVersion: 1,
		});

		const res = await post({ ids: ['ds:a'] }, ZURG);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(mockRepo.recordUsenetDead).not.toHaveBeenCalled();
	});

	it('answers 429 over the budget, before writing anything', async () => {
		vi.mocked(checkRateLimitFor).mockResolvedValue(false);

		const res = await post({ ids: ['ds:a'] });

		expect(res.status).toHaveBeenCalledWith(429);
		expect(mockRepo.recordUsenetDead).not.toHaveBeenCalled();
	});

	it.each([
		['no body', undefined],
		['no ids', {}],
		['an empty list', { ids: [] }],
		['more than 50', { ids: Array.from({ length: 51 }, (_, i) => `ds:${i}`) }],
		['a non-string', { ids: ['ds:a', 7] }],
		['a forged token', { ids: ['bm90LWEtcmVhbC10b2tlbi1hdC1hbGwtb2theQ'] }],
		['an id with no native part', { ids: ['ds:'] }],
		['an id with a space', { ids: ['ds:a b'] }],
	])('refuses %s', async (_label, body) => {
		const res = await post(body);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockRepo.recordUsenetDead).not.toHaveBeenCalled();
	});

	it('takes only POST', async () => {
		const res = await post({ ids: ['ds:a'] }, NZB2RD, 'GET');

		expect(res.status).toHaveBeenCalledWith(405);
	});

	it('answers 500 when the write fails', async () => {
		mockRepo.recordUsenetDead = vi.fn().mockRejectedValue(new Error('db down'));

		const res = await post({ ids: ['ds:a'] });

		expect(res.status).toHaveBeenCalledWith(500);
	});
});
