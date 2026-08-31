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

	// The scraped pool behind the detail page: every release for the title,
	// offered once Premiumize confirms the hash is cached. It is what makes the
	// addon show streams for a title nobody has cast.
	describe('cached trove releases', () => {
		const T1 = '1'.repeat(40);
		const T2 = '2'.repeat(40);
		const trove = [
			{ hash: T1, title: 'Project.Hail.Mary.2026.1080p.WEB-DL.x264', fileSize: 19000 },
			{ hash: T2, title: 'Project.Hail.Mary.2026.2160p.WEB-DL.x265', fileSize: 55000 },
		];

		const requestTrove = () =>
			createMockRequest({
				query: { userid: 'pm-user', mediaType: 'movie', imdbid: 'tt12042730' },
			});

		it('offers cached releases after the casts, without a stored file path', async () => {
			mockRepository.getAllScrapedTrueResults = vi.fn().mockResolvedValue(trove);
			mockCacheCheck.mockResolvedValue([
				{ hash: T1, cached: true, filename: null, filesize: null },
				{ hash: T2, cached: false, filename: null, filesize: null },
			]);

			await handler(requestTrove(), res);

			const playStreams = (res._getData() as any).streams.filter((s: any) => s.url);
			expect(playStreams).toHaveLength(1);
			// No ?file=: the play route resolves the release and picks the feature.
			expect(playStreams[0].url).toBe(`https://dmm.test/api/stremio-pm/pm-user/play/${T1}`);
			expect(playStreams[0].behaviorHints.bingeGroup).toBe('dmm-pm:tt12042730:trove:1');
			expect(mockRepository.getAllScrapedTrueResults).toHaveBeenCalledWith(
				'movie:tt12042730'
			);
		});

		// The size settings are GB. The first version of the trove filter
		// compared that value against MB file sizes, so any limit below ~1000
		// emptied the trove entirely - this pins the units at the API boundary.
		it('applies the profile size ceiling in GB to scraped releases', async () => {
			mockRepository.getPremiumizeCastProfile = vi.fn().mockResolvedValue({
				apiKey: 'viewer-key',
				movieMaxSize: 15,
				episodeMaxSize: 0,
				otherStreamsLimit: 5,
			});
			mockRepository.getAllScrapedTrueResults = vi
				.fn()
				.mockResolvedValue([
					...trove,
					{ hash: '4'.repeat(40), title: 'Small.Movie.1080p', fileSize: 8000 },
				]);
			mockCacheCheck.mockImplementation((_key: string, hashes: string[]) =>
				Promise.resolve(
					hashes.map((hash) => ({ hash, cached: true, filename: null, filesize: null }))
				)
			);

			await handler(requestTrove(), res);

			const playStreams = (res._getData() as any).streams.filter((s: any) => s.url);
			// 15 GB keeps the 7.8 GB release and drops the 18.5 GB and 53.7 GB ones.
			expect(playStreams).toHaveLength(1);
			expect(playStreams[0].url).toContain('/play/4444');
		});

		it('withholds trove releases when the cache probe fails, while casts stay unfiltered', async () => {
			mockRepository.getPremiumizeUserCastStreams = vi
				.fn()
				.mockResolvedValue([row(A, 'Live.mkv')]);
			mockRepository.getAllScrapedTrueResults = vi.fn().mockResolvedValue(trove);
			mockCacheCheck.mockRejectedValue(new Error('premiumize down'));

			await handler(requestTrove(), res);

			const playStreams = (res._getData() as any).streams.filter((s: any) => s.url);
			expect(playStreams).toHaveLength(1);
			expect(playStreams[0].url).toContain(`/play/${A}?file=`);
		});

		it('fills only the slots other casts leave open', async () => {
			mockRepository.getPremiumizeOtherStreams = vi
				.fn()
				.mockResolvedValue([row(B, 'Other1.mkv'), row('c'.repeat(40), 'Other2.mkv')]);
			mockRepository.getAllScrapedTrueResults = vi
				.fn()
				.mockResolvedValue([
					...trove,
					{ hash: '3'.repeat(40), title: 'Third.Release', fileSize: 30000 },
				]);
			mockCacheCheck.mockImplementation((_key: string, hashes: string[]) =>
				Promise.resolve(
					hashes.map((hash) => ({ hash, cached: true, filename: null, filesize: null }))
				)
			);

			await handler(requestTrove(), res);

			const playStreams = (res._getData() as any).streams.filter((s: any) => s.url);
			// 2 other casts against a limit of 5 leaves 3 trove slots.
			expect(playStreams).toHaveLength(5);
			expect(playStreams.filter((s: any) => s.url.includes('?file='))).toHaveLength(2);
		});

		it('does not probe or re-offer a hash already offered as a cast', async () => {
			mockRepository.getPremiumizeOtherStreams = vi
				.fn()
				.mockResolvedValue([row(T1, 'CastCopy.mkv')]);
			mockRepository.getAllScrapedTrueResults = vi.fn().mockResolvedValue(trove);
			mockCacheCheck.mockImplementation((_key: string, hashes: string[]) =>
				Promise.resolve(
					hashes.map((hash) => ({ hash, cached: true, filename: null, filesize: null }))
				)
			);

			await handler(requestTrove(), res);

			// T1 appears once, as the cast row - and is probed once.
			const probed = mockCacheCheck.mock.calls[0][1] as string[];
			expect(probed.filter((h) => h === T1)).toHaveLength(1);
			const playStreams = (res._getData() as any).streams.filter((s: any) => s.url);
			expect(
				playStreams.filter((s: any) =>
					s.url.startsWith(`https://dmm.test/api/stremio-pm/pm-user/play/${T1}?`)
				)
			).toHaveLength(1);
		});
	});
});
