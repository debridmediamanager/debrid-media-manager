import completeHandler from '@/pages/api/sponsor/wanted/complete';
import listHandler from '@/pages/api/sponsor/wanted/index';
import { checkRateLimitFor } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import { resolveWantedReused } from '@/services/wanted';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/wanted', () => ({ resolveWantedReused: vi.fn() }));
vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>()),
	checkRateLimitFor: vi.fn(),
}));

const mockRepository = vi.mocked(repository);
const sponsorKey = 'c'.repeat(64);
const ACTIVE = {
	isSponsor: true,
	sources: ['github' as const],
	shortId: 'ZP1M',
	githubUsername: 'someone',
	keyVersion: 1,
};
const ID = '0b7c2f8e-1d1f-4a55-9c3a-6c9d8e7f1a2b';
const row = (over: Record<string, unknown>) => ({
	id: ID,
	imdbId: 'tt0133093',
	kind: 'movie',
	title: 'The Matrix',
	seasons: null,
	createdAt: new Date(),
	fulfilledAt: null,
	lastPolledAt: null,
	...over,
});

describe('/api/sponsor/wanted', () => {
	beforeEach(() => {
		mockRepository.getSponsorByDmmApiKey = vi.fn().mockResolvedValue(ACTIVE);
		mockRepository.touchWantedPolled = vi.fn().mockResolvedValue(undefined);
		vi.mocked(checkRateLimitFor).mockResolvedValue(true);
		vi.mocked(resolveWantedReused).mockImplementation(async (r) => ({
			id: r.id,
			kind: r.kind,
			title: r.title,
			imdb: r.imdbId,
		}));
	});
	afterEach(() => vi.clearAllMocks());

	const get = (headers: Record<string, string> = { 'x-api-key': sponsorKey }) =>
		createMockRequest({ method: 'GET', headers });

	// zurg acknowledged the film, so it is done; a show is followed for new episodes.
	it('leaves acknowledged films out and keeps acknowledged shows', async () => {
		mockRepository.listWanted = vi
			.fn()
			.mockResolvedValue([
				row({ id: 'a', fulfilledAt: new Date() }),
				row({ id: 'b', imdbId: 'tt0234215', title: 'Reloaded' }),
				row({ id: 'c', kind: 'show', imdbId: 'tt0115082', fulfilledAt: new Date() }),
			]);
		const res = createMockResponse();
		await listHandler(get(), res);

		expect(res.status).toHaveBeenCalledWith(200);
		const { items } = vi.mocked(res.json).mock.calls[0][0];
		expect(items.map((i: { id: string }) => i.id)).toEqual(['b', 'c']);
		expect(mockRepository.listWanted).toHaveBeenCalledWith('ZP1M');
		expect(mockRepository.touchWantedPolled).toHaveBeenCalledWith('ZP1M');
	});

	it('refuses a missing key', async () => {
		const res = createMockResponse();
		await listHandler(get({}), res);
		expect(res.status).toHaveBeenCalledWith(401);
	});

	it('refuses a lapsed sponsorship', async () => {
		mockRepository.getSponsorByDmmApiKey = vi
			.fn()
			.mockResolvedValue({ ...ACTIVE, isSponsor: false, sources: [] });
		const res = createMockResponse();
		await listHandler(get(), res);
		expect(res.status).toHaveBeenCalledWith(401);
	});

	it('answers 429 past the per-sponsor budget', async () => {
		vi.mocked(checkRateLimitFor).mockResolvedValueOnce(false);
		const res = createMockResponse();
		await listHandler(get(), res);
		expect(res.status).toHaveBeenCalledWith(429);
		expect(vi.mocked(checkRateLimitFor).mock.calls[0][0]).toBe('sponsor:ZP1M');
	});

	it('answers 405 to a POST', async () => {
		const res = createMockResponse();
		await listHandler(
			createMockRequest({ method: 'POST', headers: { 'x-api-key': sponsorKey } }),
			res
		);
		expect(res.status).toHaveBeenCalledWith(405);
	});
});

describe('/api/sponsor/wanted/complete', () => {
	beforeEach(() => {
		mockRepository.getSponsorByDmmApiKey = vi.fn().mockResolvedValue(ACTIVE);
		vi.mocked(checkRateLimitFor).mockResolvedValue(true);
	});
	afterEach(() => vi.clearAllMocks());

	const post = (body: unknown) =>
		createMockRequest({ method: 'POST', headers: { 'x-api-key': sponsorKey }, body });

	it("records the acknowledgement on this sponsor's item", async () => {
		mockRepository.markWantedFulfilled = vi.fn().mockResolvedValue(true);
		const res = createMockResponse();
		await completeHandler(post({ id: ID }), res);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockRepository.markWantedFulfilled).toHaveBeenCalledWith('ZP1M', ID);
	});

	it('answers 404 for an item that is not on the list', async () => {
		mockRepository.markWantedFulfilled = vi.fn().mockResolvedValue(false);
		const res = createMockResponse();
		await completeHandler(post({ id: ID }), res);
		expect(res.status).toHaveBeenCalledWith(404);
	});

	it('refuses a body without an item id', async () => {
		mockRepository.markWantedFulfilled = vi.fn();
		const res = createMockResponse();
		await completeHandler(post({ id: 'nope' }), res);
		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockRepository.markWantedFulfilled).not.toHaveBeenCalled();
	});
});
