import handler from '@/pages/api/stremio-dl/[userid]/stream/[mediaType]/[imdbid]';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { getTroveCandidates } from '@/utils/cachedTroveStreams';
import { SPONSOR_MAX_OTHER_STREAMS_LIMIT } from '@/utils/sponsorLimits';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/rateLimit/withRateLimit', () => ({
	withRateLimit: (h: unknown) => h,
}));
vi.mock('@/utils/cachedTroveStreams', () => ({ getTroveCandidates: vi.fn() }));

const mockRepository = vi.mocked(repository);
const mockTrove = vi.mocked(getTroveCandidates);

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

const row = (hash: string, filename: string) => ({
	url: filename,
	filename,
	size: 700,
	hash,
	path: `Release/${filename}`,
});

const request = (over: Record<string, string> = {}) =>
	createMockRequest({
		query: { userid: 'dl-user', mediaType: 'movie', imdbid: 'tt123', ...over },
	});

describe('/api/stremio-dl/[userid]/stream/[mediaType]/[imdbid]', () => {
	let res: ReturnType<typeof createMockResponse>;
	const originalOrigin = process.env.DMM_ORIGIN;

	beforeEach(() => {
		process.env.DMM_ORIGIN = 'https://dmm.test';
		vi.clearAllMocks();
		res = createMockResponse();
		mockRepository.getDebridLinkCastProfile = vi.fn().mockResolvedValue({
			apiKey: 'viewer-token',
			movieMaxSize: 0,
			episodeMaxSize: 0,
			otherStreamsLimit: 5,
		});
		mockRepository.getDebridLinkUserCastStreams = vi.fn().mockResolvedValue([]);
		mockRepository.getDebridLinkOtherStreams = vi.fn().mockResolvedValue([]);
		mockRepository.getSnapshotsByHashes = vi.fn().mockResolvedValue([]);
		mockTrove.mockResolvedValue([]);
	});

	afterAll(() => {
		process.env.DMM_ORIGIN = originalOrigin;
	});

	it('returns 500 without a profile', async () => {
		mockRepository.getDebridLinkCastProfile = vi.fn().mockResolvedValue(null);
		await handler(request(), res);
		expect(res.status).toHaveBeenCalledWith(500);
	});

	// Debrid-Link retired `/seedbox/cached` and put nothing in its place, so the
	// only probe is a mutating add costing one of the viewer's 50 daily torrents.
	// Filtering a stream list that way would spend the whole day's quota.
	it('offers every cast unfiltered, because there is no cache probe to filter with', async () => {
		mockRepository.getDebridLinkUserCastStreams = vi
			.fn()
			.mockResolvedValue([row(A, 'Mine.mkv')]);
		mockRepository.getDebridLinkOtherStreams = vi.fn().mockResolvedValue([row(B, 'Other.mkv')]);

		await handler(request(), res);

		const titles = (res._getData() as any).streams.map((s: any) => s.title).join(' ');
		expect(titles).toContain('Mine.mkv');
		expect(titles).toContain('Other.mkv');
	});

	// The sibling routes fill spare slots from DMM's scraped pool because each of
	// them can verify a hash for free first. Here every click would cost the
	// viewer a torrent to discover the release is not cached.
	it('offers no scraped-trove releases at all', async () => {
		mockTrove.mockResolvedValue([{ hash: B, title: 'Trove.mkv', sizeMb: 900 }]);

		await handler(request(), res);

		expect(mockTrove).not.toHaveBeenCalled();
		const titles = (res._getData() as any).streams.map((s: any) => s.title ?? '').join(' ');
		expect(titles).not.toContain('Trove.mkv');
	});

	// A stream list is exactly the sort of thing a client caches, and a
	// Debrid-Link URL is a permanent unauthenticated capability.
	it('points every stream at the play route, never at a Debrid-Link URL', async () => {
		mockRepository.getDebridLinkUserCastStreams = vi
			.fn()
			.mockResolvedValue([row(A, 'Mine.mkv')]);

		await handler(request(), res);

		const stream = (res._getData() as any).streams.find((s: any) => s.url);
		expect(stream.url).toBe(
			`https://dmm.test/api/stremio-dl/dl-user/play/${A}?file=${encodeURIComponent('Release/Mine.mkv')}`
		);
		expect(JSON.stringify(res._getData())).not.toContain('debrid.link');
	});

	it('offers the cast entry point unless the profile hides it', async () => {
		await handler(request(), res);
		expect((res._getData() as any).streams[0].name).toContain('DMM Cast DL');

		const res2 = createMockResponse();
		mockRepository.getDebridLinkCastProfile = vi.fn().mockResolvedValue({
			apiKey: 'viewer-token',
			movieMaxSize: 0,
			episodeMaxSize: 0,
			otherStreamsLimit: 5,
			hideCastOption: true,
		});
		await handler(request(), res2);
		expect((res2._getData() as any).streams).toEqual([]);
	});

	// Stremio calls this endpoint with nothing but the userid, so there is no
	// token to check - the stored value is clamped to the sponsor ceiling
	// because only a sponsor could have stored one above the standard limit.
	it('clamps a stored other-streams limit to the sponsor ceiling', async () => {
		mockRepository.getDebridLinkCastProfile = vi.fn().mockResolvedValue({
			apiKey: 'viewer-token',
			movieMaxSize: 0,
			episodeMaxSize: 0,
			otherStreamsLimit: 9999,
		});

		await handler(request(), res);

		const limit = mockRepository.getDebridLinkOtherStreams.mock.calls[0][2];
		expect(limit).toBe(SPONSOR_MAX_OTHER_STREAMS_LIMIT);
	});

	it('returns 400 on a malformed request', async () => {
		await handler(createMockRequest({ query: { userid: 'dl-user' } }), res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns 500 when the cast lookup throws', async () => {
		mockRepository.getDebridLinkUserCastStreams = vi.fn().mockRejectedValue(new Error('boom'));
		await handler(request(), res);
		expect(res.status).toHaveBeenCalledWith(500);
	});
});
