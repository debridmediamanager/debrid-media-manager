import handler from '@/pages/api/metadata/tmdb/[...path]';
import { getMetadataCache } from '@/services/metadataCache';
import { ProviderCooldownError } from '@/services/providerCooldown';
import { checkRateLimitFor } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/metadataCache', () => {
	const service = { getTmdbPassthrough: vi.fn() };
	return { getMetadataCache: () => service };
});
vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>()),
	checkRateLimitFor: vi.fn(),
}));

const KEY = 'a'.repeat(64);
const SPONSOR = {
	isSponsor: true,
	sources: ['github' as const],
	shortId: 'ZP1M',
	githubUsername: 'someone',
	keyVersion: 1,
};
const passthrough = vi.mocked(getMetadataCache().getTmdbPassthrough);

const call = async (
	path: string,
	query: Record<string, string> = {},
	apiKey: string | null = KEY
) => {
	const res = createMockResponse();
	await handler(
		createMockRequest({
			method: 'GET',
			query: { ...query, path: path.split('/') },
			headers: apiKey ? { 'x-api-key': apiKey } : {},
		}),
		res
	);
	return res;
};

describe('/api/metadata/tmdb/[...path]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(repository.getSponsorByDmmApiKey).mockResolvedValue(SPONSOR);
		vi.mocked(checkRateLimitFor).mockResolvedValue(true);
	});

	// What rex asks for: a season's episode list, the names it matches files on.
	it("answers TMDB's season list as TMDB did, budgeted per sponsorship", async () => {
		const season = {
			season_number: 1,
			episodes: [{ episode_number: 1, name: 'Rollercoaster' }],
		};
		passthrough.mockResolvedValue(season);

		const res = await call('tv/1877/season/1', { language: 'en-US' });

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(season);
		expect(passthrough).toHaveBeenCalledWith('tv/1877/season/1', { language: 'en-US' });
		expect(vi.mocked(checkRateLimitFor).mock.calls[0][0]).toBe('sponsor:ZP1M');
	});

	it('refuses a caller without a live sponsorship before reading anything', async () => {
		expect((await call('tv/1877', {}, null)).status).toHaveBeenCalledWith(401);
		vi.mocked(repository.getSponsorByDmmApiKey).mockResolvedValue({
			...SPONSOR,
			isSponsor: false,
		});
		expect((await call('tv/1877')).status).toHaveBeenCalledWith(401);
		expect(passthrough).not.toHaveBeenCalled();
	});

	it('serves only the allowlisted reads and parameters, and drops a caller key', async () => {
		for (const path of ['account/1', 'tv/1877/season/1/credits', 'list/1', 'discover/tv']) {
			expect((await call(path)).status).toHaveBeenCalledWith(404);
		}
		expect(
			(await call('find/tt0852863', { external_source: 'freebase_id' })).status
		).toHaveBeenCalledWith(400);
		expect(passthrough).not.toHaveBeenCalled();

		passthrough.mockResolvedValue({});
		await call('find/tt0852863', {
			external_source: 'imdb_id',
			api_key: 'theirs',
			session_id: 'x',
		});
		expect(passthrough).toHaveBeenCalledWith('find/tt0852863', { external_source: 'imdb_id' });
	});

	it('answers 429 once the sponsorship has spent its minute', async () => {
		vi.mocked(checkRateLimitFor).mockResolvedValue(false);
		expect((await call('tv/1877')).status).toHaveBeenCalledWith(429);
		expect(passthrough).not.toHaveBeenCalled();
	});

	it("passes TMDB's 404 through and turns its rate limit into 503 with Retry-After", async () => {
		passthrough.mockRejectedValueOnce({ response: { status: 404, data: { status_code: 34 } } });
		const missing = await call('tv/999999999');
		expect(missing.status).toHaveBeenCalledWith(404);
		expect(missing.json).toHaveBeenCalledWith({ status_code: 34 });

		passthrough.mockRejectedValueOnce(new ProviderCooldownError('api.themoviedb.org', 9000));
		const limited = await call('tv/1877');
		expect(limited.status).toHaveBeenCalledWith(503);
		expect(limited.setHeader).toHaveBeenCalledWith('Retry-After', '9');
	});
});
