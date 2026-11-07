import handler from '@/pages/api/stremio-en/[userid]/stream/[mediaType]/[imdbid]';
import { EasynewsAuthError } from '@/services/easynews';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { easynewsCastKey } from '@/utils/easynewsCastKey';
import { easynewsStreamResults, goneEasynewsPaths } from '@/utils/easynewsCastSearch';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/castTelemetry', () => ({ recordCastUse: vi.fn() }));
vi.mock('@/services/rateLimit/withRateLimit', () => ({ withRateLimit: (h: unknown) => h }));
vi.mock('@/utils/easynewsCastSearch', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/utils/easynewsCastSearch')>()),
	easynewsStreamResults: vi.fn(),
	goneEasynewsPaths: vi.fn(),
}));
vi.mock('@/services/anime/stremioAnime', () => ({
	resolveStreamTarget: vi.fn(async (id: string, mediaType: string, origin: string) => ({
		castKey: id,
		typeSlug: mediaType === 'movie' ? 'movie' : 'show',
		// The real shapes: /movie/<id>, and /show/<id>/<season> for an episode.
		externalUrl:
			mediaType === 'movie'
				? `${origin}/movie/${id}`
				: `${origin}/show/${id.split(':')[0]}/${id.split(':')[1]}`,
		trove: async () => [],
	})),
}));

const mockRepository = vi.mocked(repository);
const mockSearch = vi.mocked(easynewsStreamResults);
const mockGone = vi.mocked(goneEasynewsPaths);
const LOGIN = { username: 'alice', password: 'pw' };
const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const C = 'c'.repeat(32);
const path = (hash: string, name: string) => `${hash}.mkv/${name}.mkv`;
const cast = (hash: string, name: string, size = 7000) => ({
	url: `${name}.mkv`,
	filename: `${name}.mkv`,
	size,
	hash,
	path: path(hash, name),
});

const request = (imdbid = 'tt11280740:2:5', mediaType = 'series') =>
	createMockRequest({ query: { userid: 'en-user', mediaType, imdbid: `${imdbid}.json` } });

describe('/api/stremio-en/[userid]/stream/[mediaType]/[imdbid]', () => {
	const originalOrigin = process.env.DMM_ORIGIN;

	beforeEach(() => {
		process.env.DMM_ORIGIN = 'https://dmm.test';
		vi.clearAllMocks();
		mockRepository.getEasynewsCastProfile = vi.fn().mockResolvedValue({
			apiKey: easynewsCastKey(LOGIN),
			movieMaxSize: 0,
			episodeMaxSize: 15,
			otherStreamsLimit: 5,
			hideCastOption: false,
		});
		mockRepository.getEasynewsUserCastStreams = vi.fn().mockResolvedValue([]);
		mockRepository.getEasynewsOtherStreams = vi.fn().mockResolvedValue([]);
		mockSearch.mockResolvedValue([]);
		mockGone.mockResolvedValue(new Set());
	});
	afterAll(() => {
		process.env.DMM_ORIGIN = originalOrigin;
	});

	it('answers a missing profile with one stream that opens the setup page', async () => {
		mockRepository.getEasynewsCastProfile = vi.fn().mockResolvedValue(null);
		const res = createMockResponse();
		await handler(request(), res);
		expect((res._getData() as any).streams).toEqual([
			expect.objectContaining({ externalUrl: 'https://dmm.test/stremio-easynews' }),
		]);
	});

	// The phone lands where the Cast button is: Stremio's row and Kodi's cast QR open it.
	it('opens the Usenet tab, where the Easynews rows are, from the cast row', async () => {
		const show = createMockResponse();
		await handler(request(), show);
		expect((show._getData() as any).streams[0].externalUrl).toBe(
			'https://dmm.test/show/tt11280740/2/usenet'
		);
	});

	it('lists own casts, then other casts, then search hits, each as a play link', async () => {
		const own = 'severance.2022.s02e05.multi.2160p.web.h265-higgsboson';
		const other = 'Severance.S02E05.1080p.WEB.H264-GRP';
		const found = 'Severance.S02E05.720p.WEB.H264-OTHER';
		mockRepository.getEasynewsUserCastStreams = vi.fn().mockResolvedValue([cast(A, own)]);
		mockRepository.getEasynewsOtherStreams = vi.fn().mockResolvedValue([cast(B, other, 3000)]);
		mockSearch.mockResolvedValue([
			// Already offered as the member's own cast: not listed twice.
			{ path: path(A, own), title: own, size: 7000 * 1024 * 1024 },
			{ path: path(C, found), title: found, size: 1.5 * 1024 * 1024 * 1024 },
		]);

		const res = createMockResponse();
		await handler(request(), res);

		const { streams } = res._getData() as any;
		expect(streams.map((s: any) => s.name)).toEqual([
			'DMM Cast EN ✨',
			'2160p • 6.84 GB',
			'1080p • 2.93 GB',
			'720p • 1.50 GB',
		]);
		expect(streams[1].title).toContain('DMM Cast EN (Yours)');
		expect(streams[3].url).toBe(
			`https://dmm.test/api/stremio-en/en-user/play/${C}?path=${encodeURIComponent(path(C, found))}`
		);
		// The search runs with the profile's own login and the episode size limit.
		expect(mockSearch).toHaveBeenCalledWith(LOGIN, 'tt11280740:2:5', 15);
	});

	it('fills only the other-streams budget left by other casts', async () => {
		mockRepository.getEasynewsCastProfile = vi.fn().mockResolvedValue({
			apiKey: easynewsCastKey(LOGIN),
			movieMaxSize: 0,
			episodeMaxSize: 0,
			otherStreamsLimit: 2,
			hideCastOption: true,
		});
		mockRepository.getEasynewsOtherStreams = vi
			.fn()
			.mockResolvedValue([cast(B, 'Severance.S02E05.1080p.WEB.H264-GRP')]);
		mockSearch.mockResolvedValue(
			[C, 'd'.repeat(32), 'e'.repeat(32)].map((h, i) => ({
				path: path(h, `Severance.S02E05.72${i}p.WEB-X`),
				title: `Severance.S02E05.72${i}p.WEB-X`,
				size: 1e9,
			}))
		);
		const res = createMockResponse();
		await handler(request(), res);
		expect((res._getData() as any).streams).toHaveLength(2);
	});

	// Stremio's next-episode autoplay keeps the stream whose bingeGroup matches.
	it('gives every episode of one release the same bingeGroup', async () => {
		mockSearch.mockResolvedValue([
			{
				path: path(C, 'Severance.S02E05.1080p.WEB.H264-GRP'),
				title: 'Severance.S02E05.1080p.WEB.H264-GRP',
				size: 1e9,
			},
		]);
		const first = createMockResponse();
		await handler(request(), first);
		mockSearch.mockResolvedValue([
			{
				path: path(A, 'Severance.S02E06.1080p.WEB.H264-GRP'),
				title: 'Severance.S02E06.1080p.WEB.H264-GRP',
				size: 1e9,
			},
		]);
		const next = createMockResponse();
		await handler(request('tt11280740:2:6'), next);
		const group = (res: any) => res._getData().streams[1].behaviorHints.bingeGroup;
		expect(group(first)).toBe(group(next));
	});

	// Severance S02E01 NEUROSiS: listed by search, 410 on every request (2026-11-07).
	it('drops a file Easynews no longer serves and fills its slot from the spares', async () => {
		mockRepository.getEasynewsCastProfile = vi.fn().mockResolvedValue({
			apiKey: easynewsCastKey(LOGIN),
			movieMaxSize: 0,
			episodeMaxSize: 0,
			otherStreamsLimit: 2,
			hideCastOption: true,
		});
		const own = cast(A, 'Severance.S02E05.1080p.WEB.H264-DEAD');
		mockRepository.getEasynewsUserCastStreams = vi.fn().mockResolvedValue([own]);
		const hits = [B, C, 'd'.repeat(32)].map((h, i) => ({
			path: path(h, `Severance.S02E05.72${i}p.WEB-X`),
			title: `Severance.S02E05.72${i}p.WEB-X`,
			size: 1e9,
		}));
		mockSearch.mockResolvedValue(hits);
		mockGone.mockResolvedValue(new Set([own.path, hits[0].path]));

		const res = createMockResponse();
		await handler(request(), res);

		expect(mockGone).toHaveBeenCalledWith(LOGIN, [own.path, ...hits.map((h) => h.path)]);
		const urls = (res._getData() as any).streams.map((s: any) => s.url);
		expect(urls).toHaveLength(2);
		expect(urls[0]).toContain(encodeURIComponent(hits[1].path));
		expect(urls[1]).toContain(encodeURIComponent(hits[2].path));
	});

	it('answers a refused login with the sign-in notice', async () => {
		mockSearch.mockRejectedValue(new EasynewsAuthError());
		const res = createMockResponse();
		await handler(request(), res);
		const { streams } = res._getData() as any;
		expect(streams).toHaveLength(1);
		expect(streams[0].title).toBe('Sign in to Easynews again');
	});

	it('still lists the casts when the search fails', async () => {
		mockRepository.getEasynewsUserCastStreams = vi
			.fn()
			.mockResolvedValue([cast(A, 'Severance.S02E05.1080p.WEB.H264-GRP')]);
		mockSearch.mockRejectedValue(new Error('Easynews search failed: HTTP 502'));
		const res = createMockResponse();
		await handler(request(), res);
		expect(res._getStatusCode()).toBe(200);
		expect((res._getData() as any).streams).toHaveLength(2);
	});

	it('does not search when the member wants no other streams', async () => {
		mockRepository.getEasynewsCastProfile = vi.fn().mockResolvedValue({
			apiKey: easynewsCastKey(LOGIN),
			movieMaxSize: 0,
			episodeMaxSize: 0,
			otherStreamsLimit: 0,
			hideCastOption: false,
		});
		const res = createMockResponse();
		await handler(request(), res);
		expect(mockSearch).not.toHaveBeenCalled();
	});

	it('does not choke on a % in a release name', async () => {
		mockSearch.mockResolvedValue([
			{ path: path(C, '100%.Wolf.2020.1080p'), title: '100%.Wolf.2020.1080p', size: 1e9 },
		]);
		const res = createMockResponse();
		await handler(request('tt9999999', 'movie'), res);
		expect((res._getData() as any).streams[1].title).toContain('100%.Wolf');
	});
});
