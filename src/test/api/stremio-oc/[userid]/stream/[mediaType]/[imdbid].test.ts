import handler from '@/pages/api/stremio-oc/[userid]/stream/[mediaType]/[imdbid]';
import { checkOffcloudCache } from '@/services/offcloud';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/offcloud');
vi.mock('@/services/repository');
vi.mock('@/services/rateLimit/withRateLimit', () => ({
	withRateLimit: (h: unknown) => h,
}));

const mockRepository = vi.mocked(repository);
const mockCacheCheck = vi.mocked(checkOffcloudCache);

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
	createMockRequest({ query: { userid: 'oc-user', mediaType: 'movie', imdbid: 'tt123' } });

describe('/api/stremio-oc/[userid]/stream/[mediaType]/[imdbid]', () => {
	let res: ReturnType<typeof createMockResponse>;
	const originalOrigin = process.env.DMM_ORIGIN;

	beforeEach(() => {
		process.env.DMM_ORIGIN = 'https://dmm.test';
		vi.clearAllMocks();
		res = createMockResponse();
		mockRepository.getOffcloudCastProfile = vi.fn().mockResolvedValue({
			apiKey: 'viewer-key',
			movieMaxSize: 0,
			episodeMaxSize: 0,
			otherStreamsLimit: 5,
		});
		mockRepository.getOffcloudUserCastStreams = vi.fn().mockResolvedValue([]);
		mockRepository.getOffcloudOtherStreams = vi.fn().mockResolvedValue([]);
		mockRepository.getSnapshotsByHashes = vi.fn().mockResolvedValue([]);
		mockCacheCheck.mockResolvedValue([]);
	});

	afterAll(() => {
		process.env.DMM_ORIGIN = originalOrigin;
	});

	it('returns 500 without a profile', async () => {
		mockRepository.getOffcloudCastProfile = vi.fn().mockResolvedValue(null);
		await handler(request(), res);
		expect(res.status).toHaveBeenCalledWith(500);
	});

	// `POST /api/cache` is free, non-destructive and batched, so a hash that has
	// fallen out of the cache is dropped here rather than handed over as a
	// stream that errors on click.
	it('drops a cast whose hash has fallen out of the Offcloud cache', async () => {
		mockRepository.getOffcloudUserCastStreams = vi.fn().mockResolvedValue([row(A, 'Live.mkv')]);
		mockRepository.getOffcloudOtherStreams = vi.fn().mockResolvedValue([row(B, 'Gone.mkv')]);
		mockCacheCheck.mockResolvedValue([
			{ hash: A, cached: true },
			{ hash: B, cached: false },
		]);

		await handler(request(), res);

		const titles = (res._getData() as any).streams.map((s: any) => s.title).join(' ');
		expect(titles).toContain('Live.mkv');
		expect(titles).not.toContain('Gone.mkv');
	});

	it('matches the cache answer case-insensitively', async () => {
		mockRepository.getOffcloudUserCastStreams = vi.fn().mockResolvedValue([row(A, 'Live.mkv')]);
		mockCacheCheck.mockResolvedValue([{ hash: A.toUpperCase(), cached: true }]);

		await handler(request(), res);

		expect((res._getData() as any).streams.some((s: any) => s.url)).toBe(true);
	});

	// A failed probe must not empty the list - that would turn an Offcloud
	// hiccup into "you have nothing cast".
	it('offers everything unfiltered when the cache probe itself fails', async () => {
		mockRepository.getOffcloudUserCastStreams = vi.fn().mockResolvedValue([row(A, 'Live.mkv')]);
		mockCacheCheck.mockRejectedValue(new Error('offcloud down'));

		await handler(request(), res);

		expect((res._getData() as any).streams.some((s: any) => s.url)).toBe(true);
	});

	it('points play at the hash and the stored path, never at a stored link', async () => {
		mockRepository.getOffcloudUserCastStreams = vi.fn().mockResolvedValue([row(A, 'Live.mkv')]);
		mockCacheCheck.mockResolvedValue([{ hash: A, cached: true }]);

		await handler(request(), res);

		const url = (res._getData() as any).streams.find((s: any) => s.url).url;
		expect(url).toBe(
			`https://dmm.test/api/stremio-oc/oc-user/play/${A}?file=${encodeURIComponent('Release/Live.mkv')}`
		);
		expect(JSON.stringify(res._getData())).not.toContain('energycdn.com');
	});

	it('offers the cast entry point unless the profile hides it', async () => {
		await handler(request(), res);
		expect((res._getData() as any).streams[0].name).toBe('DMM Cast OC✨');

		mockRepository.getOffcloudCastProfile = vi.fn().mockResolvedValue({
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

	// The scraped pool behind the detail page: every release for the title,
	// offered once Offcloud confirms the hash is cached.
	describe('cached trove releases', () => {
		const T1 = '1'.repeat(40);
		const T2 = '2'.repeat(40);
		const trove = [
			{ hash: T1, title: 'Project.Hail.Mary.2026.1080p.WEB-DL.x264', fileSize: 19000 },
			{ hash: T2, title: 'Project.Hail.Mary.2026.2160p.WEB-DL.x265', fileSize: 55000 },
		];

		const requestTrove = () =>
			createMockRequest({
				query: { userid: 'oc-user', mediaType: 'movie', imdbid: 'tt12042730' },
			});

		it('offers cached releases after the casts, without a stored file path', async () => {
			mockRepository.getAllScrapedTrueResults = vi.fn().mockResolvedValue(trove);
			mockCacheCheck.mockResolvedValue([
				{ hash: T1, cached: true },
				{ hash: T2, cached: false },
			]);

			await handler(requestTrove(), res);

			const playStreams = (res._getData() as any).streams.filter((s: any) => s.url);
			expect(playStreams).toHaveLength(1);
			// No ?file=: the play route resolves the release and picks the feature.
			expect(playStreams[0].url).toBe(`https://dmm.test/api/stremio-oc/oc-user/play/${T1}`);
			expect(playStreams[0].behaviorHints.bingeGroup).toBe('dmm-oc:tt12042730:trove:1');
		});

		it('withholds trove releases when the cache probe fails, while casts stay unfiltered', async () => {
			mockRepository.getOffcloudUserCastStreams = vi
				.fn()
				.mockResolvedValue([row(A, 'Live.mkv')]);
			mockRepository.getAllScrapedTrueResults = vi.fn().mockResolvedValue(trove);
			mockCacheCheck.mockRejectedValue(new Error('offcloud down'));

			await handler(requestTrove(), res);

			const playStreams = (res._getData() as any).streams.filter((s: any) => s.url);
			expect(playStreams).toHaveLength(1);
			expect(playStreams[0].url).toContain(`/play/${A}?file=`);
		});

		it('does not probe or re-offer a hash already offered as a cast', async () => {
			mockRepository.getOffcloudOtherStreams = vi
				.fn()
				.mockResolvedValue([row(T1, 'CastCopy.mkv')]);
			mockRepository.getAllScrapedTrueResults = vi.fn().mockResolvedValue(trove);
			mockCacheCheck.mockImplementation((_key: string, hashes: string[]) =>
				Promise.resolve(hashes.map((hash) => ({ hash, cached: true })))
			);

			await handler(requestTrove(), res);

			const probed = mockCacheCheck.mock.calls[0][1] as string[];
			expect(probed.filter((h) => h === T1)).toHaveLength(1);
		});
	});
});
