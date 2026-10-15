import handler from '@/pages/api/metadata/[id]';
import { getMetadata, getMetadataBundle } from '@/services/metadata';
import { checkRateLimitFor } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/metadata', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/metadata')>()),
	getMetadata: vi.fn(),
	getMetadataBundle: vi.fn(),
}));
vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>()),
	checkRateLimitFor: vi.fn(),
}));

const SPONSOR = {
	isSponsor: true,
	sources: ['github' as const],
	shortId: 'ZP1M',
	githubUsername: 'someone',
	keyVersion: 1,
};
const KEY = 'a'.repeat(64);

const call = async (
	query: Record<string, string>,
	authorization?: string,
	method = 'GET',
	apiKey?: string
) => {
	const req = createMockRequest({
		method,
		query,
		headers: {
			...(authorization ? { authorization } : {}),
			...(apiKey ? { 'x-api-key': apiKey } : {}),
		},
	});
	const res = createMockResponse();
	await handler(req, res);
	return res;
};

describe('/api/metadata/[id]', () => {
	const original = process.env.METADATA_API_SECRET;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.METADATA_API_SECRET = 's3cret';
		vi.mocked(repository.getSponsorByDmmApiKey).mockResolvedValue(SPONSOR);
		vi.mocked(checkRateLimitFor).mockResolvedValue(true);
	});

	afterEach(() => {
		if (original === undefined) delete process.env.METADATA_API_SECRET;
		else process.env.METADATA_API_SECRET = original;
	});

	it('refuses a request without the secret, with a wrong one, and when none is configured', async () => {
		expect((await call({ id: 'tt0245429' })).status).toHaveBeenCalledWith(401);
		expect((await call({ id: 'tt0245429' }, 'Bearer nope')).status).toHaveBeenCalledWith(401);
		delete process.env.METADATA_API_SECRET;
		expect((await call({ id: 'tt0245429' }, 'Bearer ')).status).toHaveBeenCalledWith(401);
		expect(getMetadata).not.toHaveBeenCalled();
	});

	it('rejects a malformed id and a non-GET', async () => {
		expect((await call({ id: 'spirited' }, 'Bearer s3cret')).status).toHaveBeenCalledWith(400);
		expect(
			(await call({ id: 'tt0245429' }, 'Bearer s3cret', 'POST')).status
		).toHaveBeenCalledWith(405);
	});

	it('answers the canonical record', async () => {
		vi.mocked(getMetadata).mockResolvedValue({
			id: 'tt0245429',
			type: 'movie',
			year: 2001,
		} as any);
		const res = await call({ id: 'tt0245429' }, 'Bearer s3cret');
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ year: 2001 }));
	});

	it('answers 404 for an id no provider knows, and 500 when the lookup throws', async () => {
		vi.mocked(getMetadata).mockResolvedValueOnce(null);
		expect((await call({ id: 'tt9999999' }, 'Bearer s3cret')).status).toHaveBeenCalledWith(404);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.mocked(getMetadata).mockRejectedValueOnce(new Error('boom'));
		expect((await call({ id: 'tt9999999' }, 'Bearer s3cret')).status).toHaveBeenCalledWith(500);
	});

	// The sponsor API: every source's record for a title named by IMDb or TMDB id.
	it('answers a sponsor every source for tmdb:tv:N, budgeted per sponsorship', async () => {
		const bundle = { ids: { tmdb: 1877 }, type: 'show', merged: null, sources: {} };
		vi.mocked(getMetadataBundle).mockResolvedValue(bundle as any);
		const res = await call({ id: 'tmdb:tv:1877', season: '2' }, undefined, 'GET', KEY);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(bundle);
		expect(getMetadataBundle).toHaveBeenCalledWith(
			{ by: 'tmdb', kind: 'tv', tmdb: 1877 },
			{ season: 2, episode: undefined, tmdbOnly: false }
		);
		expect(vi.mocked(checkRateLimitFor).mock.calls[0][0]).toBe('sponsor:ZP1M');
	});

	it('refuses a lapsed sponsorship, a spent minute, and a malformed id or season', async () => {
		vi.mocked(checkRateLimitFor).mockResolvedValueOnce(false);
		expect(
			(await call({ id: 'imdb:tt0852863' }, undefined, 'GET', KEY)).status
		).toHaveBeenCalledWith(429);
		vi.mocked(repository.getSponsorByDmmApiKey).mockResolvedValueOnce({
			...SPONSOR,
			isSponsor: false,
		});
		expect(
			(await call({ id: 'imdb:tt0852863' }, undefined, 'GET', KEY)).status
		).toHaveBeenCalledWith(401);
		for (const query of <Record<string, string>[]>[
			{ id: 'tmdb:1877' },
			{ id: 'tmdb:tv:1877', season: 'x' },
			{ id: 'tmdb:tv:1877', episode: '1' },
		]) {
			expect((await call(query, undefined, 'GET', KEY)).status).toHaveBeenCalledWith(400);
		}
		expect(getMetadataBundle).not.toHaveBeenCalled();
	});
});
