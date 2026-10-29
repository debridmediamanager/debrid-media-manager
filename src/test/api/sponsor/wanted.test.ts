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
	fulfilled: null,
	lastPolledAt: null,
	...over,
});
const TOOK = {
	release: 'The.Matrix.1999.1080p.BluRay.x264-GRP',
	grab: 'c'.repeat(40),
	torrent: true,
	resolution: '1080p',
};

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

	// zurg holds a release and wants a better one, so the film stays listed with what it holds.
	it('keeps an acknowledged film zurg wants upgraded, with what it holds', async () => {
		mockRepository.listWanted = vi.fn().mockResolvedValue([
			row({ id: 'a', fulfilledAt: new Date(), fulfilled: TOOK }),
			row({ id: 'b', fulfilledAt: new Date(), fulfilled: { ...TOOK, upgradeTo: '2160p' } }),
			row({
				id: 'c',
				kind: 'show',
				imdbId: 'tt0115082',
				fulfilledAt: new Date(),
				fulfilled: { ...TOOK, upgradeTo: '2160p' },
			}),
		]);
		const res = createMockResponse();
		await listHandler(get(), res);

		const { items } = vi.mocked(res.json).mock.calls[0][0];
		expect(items.map((i: { id: string }) => i.id)).toEqual(['b', 'c']);
		expect(items[0].upgrade).toEqual({ grab: TOOK.grab, resolution: '1080p', to: '2160p' });
		expect(items[1]).not.toHaveProperty('upgrade');
		expect(items[0]).not.toHaveProperty('release');
		expect(items[0]).not.toHaveProperty('torrent');
	});

	// The resolution is reused for half an hour; what zurg holds must not be.
	it('reads the upgrade from the row on every poll, not from the reused resolution', async () => {
		const reused = { id: 'b', kind: 'movie' as const, title: 'The Matrix', imdb: 'tt0133093' };
		vi.mocked(resolveWantedReused).mockResolvedValue(reused);
		const poll = async (fulfilled: unknown) => {
			mockRepository.listWanted = vi
				.fn()
				.mockResolvedValue([row({ id: 'b', fulfilledAt: new Date(), fulfilled })]);
			const res = createMockResponse();
			await listHandler(get(), res);
			return vi.mocked(res.json).mock.calls[0][0].items;
		};

		expect((await poll({ ...TOOK, upgradeTo: '2160p' }))[0].upgrade.grab).toBe(TOOK.grab);
		const better = { ...TOOK, grab: 'd'.repeat(40), resolution: '2160p' };
		expect((await poll({ ...better, upgradeTo: '2160p' }))[0].upgrade).toEqual({
			grab: 'd'.repeat(40),
			resolution: '2160p',
			to: '2160p',
		});
		expect(await poll(better)).toEqual([]);
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

	// What older zurgs send. It replaces the stored record, so any upgrade wish ends.
	it("records the acknowledgement on this sponsor's item", async () => {
		mockRepository.markWantedFulfilled = vi.fn().mockResolvedValue(true);
		const res = createMockResponse();
		await completeHandler(post({ id: ID }), res);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockRepository.markWantedFulfilled).toHaveBeenCalledWith('ZP1M', ID, {
			release: '',
			grab: '',
			torrent: false,
			resolution: '',
		});
	});

	it('stores what zurg took and the resolution it wants', async () => {
		mockRepository.markWantedFulfilled = vi.fn().mockResolvedValue(true);
		const res = createMockResponse();
		await completeHandler(post({ id: ID, ...TOOK, upgrade_to: '2160p' }), res);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockRepository.markWantedFulfilled).toHaveBeenCalledWith('ZP1M', ID, {
			...TOOK,
			upgradeTo: '2160p',
		});
	});

	it.each([
		['upgrade_to', { upgrade_to: '2160p' }],
		['upgrade_to', { resolution: '', upgrade_to: '2160p' }],
		['upgrade_to', { resolution: '1080p', upgrade_to: '4k' }],
		['resolution', { resolution: '1440p' }],
		['release', { release: 'x'.repeat(513) }],
		['grab', { grab: 'x'.repeat(65) }],
		['torrent', { torrent: 'yes' }],
	])('refuses a malformed %s', async (field, fields) => {
		mockRepository.markWantedFulfilled = vi.fn();
		const res = createMockResponse();
		await completeHandler(post({ id: ID, ...fields }), res);
		expect(res.status).toHaveBeenCalledWith(400);
		expect(vi.mocked(res.json).mock.calls[0][0].error).toContain(`"${field}"`);
		expect(mockRepository.markWantedFulfilled).not.toHaveBeenCalled();
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
