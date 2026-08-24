import handler from '@/pages/api/stremio-pm/[userid]/stream/[mediaType]/[imdbid]';
import { checkPremiumizeCache } from '@/services/premiumize';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/premiumize');
vi.mock('@/services/repository');
vi.mock('@/services/rateLimit/withRateLimit', () => ({
	withRateLimit: (h: unknown) => h,
}));

const mockRepository = vi.mocked(repository);
const mockCacheCheck = vi.mocked(checkPremiumizeCache);

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

const row = (hash: string, filename: string) => ({
	url: filename,
	filename,
	size: 700,
	hash,
	path: `Release/${filename}`,
});

const request = () =>
	createMockRequest({ query: { userid: 'pm-user', mediaType: 'movie', imdbid: 'tt123' } });

describe('/api/stremio-pm/[userid]/stream/[mediaType]/[imdbid]', () => {
	let res: ReturnType<typeof createMockResponse>;
	const originalOrigin = process.env.DMM_ORIGIN;

	beforeEach(() => {
		process.env.DMM_ORIGIN = 'https://dmm.test';
		vi.clearAllMocks();
		res = createMockResponse();
		mockRepository.getPremiumizeCastProfile = vi.fn().mockResolvedValue({
			apiKey: 'viewer-key',
			movieMaxSize: 0,
			episodeMaxSize: 0,
			otherStreamsLimit: 5,
		});
		mockRepository.getPremiumizeUserCastStreams = vi.fn().mockResolvedValue([]);
		mockRepository.getPremiumizeOtherStreams = vi.fn().mockResolvedValue([]);
		mockRepository.getSnapshotsByHashes = vi.fn().mockResolvedValue([]);
	});

	afterAll(() => {
		process.env.DMM_ORIGIN = originalOrigin;
	});

	it('returns 500 without a profile', async () => {
		mockRepository.getPremiumizeCastProfile = vi.fn().mockResolvedValue(null);
		await handler(request(), res);
		expect(res.status).toHaveBeenCalledWith(500);
	});

	// Premiumize is the one provider that can answer "will this actually play?"
	// before offering it: cache/check is free, non-destructive and batched.
	it('drops a cast whose hash has fallen out of the Premiumize cache', async () => {
		mockRepository.getPremiumizeUserCastStreams = vi
			.fn()
			.mockResolvedValue([row(A, 'Live.mkv')]);
		mockRepository.getPremiumizeOtherStreams = vi.fn().mockResolvedValue([row(B, 'Gone.mkv')]);
		mockCacheCheck.mockResolvedValue([
			{ hash: A, cached: true, filename: null, filesize: null },
			{ hash: B, cached: false, filename: null, filesize: null },
		]);

		await handler(request(), res);

		const titles = (res._getData() as any).streams.map((s: any) => s.title).join(' ');
		expect(titles).toContain('Live.mkv');
		expect(titles).not.toContain('Gone.mkv');
	});

	it('matches the cache answer case-insensitively', async () => {
		mockRepository.getPremiumizeUserCastStreams = vi
			.fn()
			.mockResolvedValue([row(A, 'Live.mkv')]);
		mockCacheCheck.mockResolvedValue([
			{ hash: A.toUpperCase(), cached: true, filename: null, filesize: null },
		]);

		await handler(request(), res);

		expect((res._getData() as any).streams.some((s: any) => s.url)).toBe(true);
	});

	// A failed probe must not empty the list - that would turn a Premiumize
	// hiccup into "you have nothing cast".
	it('offers everything unfiltered when the cache probe itself fails', async () => {
		mockRepository.getPremiumizeUserCastStreams = vi
			.fn()
			.mockResolvedValue([row(A, 'Live.mkv')]);
		mockCacheCheck.mockRejectedValue(new Error('premiumize down'));

		await handler(request(), res);

		expect((res._getData() as any).streams.some((s: any) => s.url)).toBe(true);
	});

	it('points play at the hash and the stored path, never at a stored link', async () => {
		mockRepository.getPremiumizeUserCastStreams = vi
			.fn()
			.mockResolvedValue([row(A, 'Live.mkv')]);
		mockCacheCheck.mockResolvedValue([
			{ hash: A, cached: true, filename: null, filesize: null },
		]);

		await handler(request(), res);

		const url = (res._getData() as any).streams.find((s: any) => s.url).url;
		expect(url).toBe(
			`https://dmm.test/api/stremio-pm/pm-user/play/${A}?file=${encodeURIComponent('Release/Live.mkv')}`
		);
	});

	it('offers the cast entry point unless the profile hides it', async () => {
		mockCacheCheck.mockResolvedValue([]);
		await handler(request(), res);
		expect((res._getData() as any).streams[0].name).toBe('DMM Cast PM✨');

		mockRepository.getPremiumizeCastProfile = vi.fn().mockResolvedValue({
			apiKey: 'viewer-key',
			movieMaxSize: 0,
			episodeMaxSize: 0,
			otherStreamsLimit: 5,
			hideCastOption: true,
		});
		const res2 = createMockResponse();
		await handler(request(), res2);
		expect((res2._getData() as any).streams).toEqual([]);
	});
});
