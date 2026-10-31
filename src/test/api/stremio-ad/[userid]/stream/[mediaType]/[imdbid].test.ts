import handler from '@/pages/api/stremio-ad/[userid]/stream/[mediaType]/[imdbid]';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { activeCastGrant } from '@/test/utils/sponsor';
import { parseSavedLinkMetaId, savedLinkMetaId } from '@/utils/allDebridCastCatalogHelper';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');

const mockRepository = vi.mocked(repository);

describe('/api/stremio-ad/[userid]/stream/[mediaType]/[imdbid]', () => {
	const originalOrigin = process.env.DMM_ORIGIN;

	beforeEach(() => {
		process.env.DMM_ORIGIN = 'https://dmm.test';
		vi.clearAllMocks();
		mockRepository.getAllDebridCastProfile = vi.fn();
		mockRepository.getAllDebridUserCastStreams = vi.fn();
		mockRepository.getAllDebridOtherStreams = vi.fn();
		mockRepository.getSnapshotsByHashes = vi.fn().mockResolvedValue([]);
	});

	afterAll(() => {
		process.env.DMM_ORIGIN = originalOrigin;
	});

	it('validates query parameters', async () => {
		const req = createMockRequest({ query: { userid: 'user', mediaType: 'movie' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('answers a missing profile with one stream that opens the setup page', async () => {
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue(null);
		const req = createMockRequest({
			query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect((res._getData() as any).streams).toEqual([
			expect.objectContaining({ externalUrl: expect.stringMatching(/\/stremio-alldebrid$/) }),
		]);
	});

	describe('settings behavior', () => {
		const setupProfile = (overrides: Record<string, unknown> = {}) => {
			mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue({
				apiKey: 'ad-key',
				movieMaxSize: 0,
				episodeMaxSize: 0,
				otherStreamsLimit: 5,
				hideCastOption: false,
				...overrides,
			});
		};

		const userStream = {
			url: 'https://files.dmm.test/MyMovie.mkv',
			hash: 'userhash1234',
			size: 5120,
			filename: 'MyMovie.mkv',
			magnetId: 100,
			fileIndex: 0,
		};

		const otherStream = {
			url: 'https://files.dmm.test/OtherMovie.mkv',
			hash: 'otherhash5678',
			size: 3072,
			filename: 'OtherMovie.mkv',
			magnetId: 200,
			fileIndex: 0,
		};

		it('otherStreamsLimit does not affect user cast streams', async () => {
			setupProfile({ otherStreamsLimit: 0 });
			mockRepository.getAllDebridUserCastStreams = vi.fn().mockResolvedValue([userStream]);
			mockRepository.getAllDebridOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getAllDebridUserCastStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				5
			);
			expect(mockRepository.getAllDebridOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				0,
				undefined
			);

			const payload = (res.json as Mock).mock.calls[0][0];
			const nonCastStreams = payload.streams.filter((s: any) => !s.externalUrl);
			expect(nonCastStreams).toHaveLength(1);
		});

		// A release DMM has seen cached on AllDebrid arrives with no magnet of anyone's, only the
		// `/f/` link it was recorded with; it plays through the saved-link id the play route reads.
		const cachedRelease = {
			url: 'https://alldebrid.com/f/REDACTEDTOKEN1',
			link: 'https://alldebrid.com/f/REDACTEDTOKEN1',
			hash: 'f2337b554a945c7f86d8189fa9a8679eb6103f14',
			size: 58973.3,
			filename: 'Heat.1995.2160p.BluRay.REMUX.HEVC.DTS-HD.MA.5.1-FGT.mkv',
			magnetId: null,
			fileIndex: null,
			savedLink: 'https://alldebrid.com/f/REDACTEDTOKEN1',
		};

		it('offers a release DMM has seen cached as a saved-link stream', async () => {
			setupProfile();
			mockRepository.getAllDebridUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getAllDebridOtherStreams = vi
				.fn()
				.mockResolvedValue([cachedRelease, otherStream]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt0113277' },
			});
			const res = createMockResponse();
			await handler(req, res);

			const urls = (res.json as Mock).mock.calls[0][0].streams
				.filter((s: any) => s.url)
				.map((s: any) => s.url.split('/play/')[1]);
			expect(urls).toEqual([`${savedLinkMetaId(cachedRelease.savedLink)}:0`, '200:0']);
			expect(parseSavedLinkMetaId(urls[0].split(':')[0])).toBe(cachedRelease.savedLink);
		});

		it('leaves out a cached release whose hash was taken down', async () => {
			const { setBlocklistForTests } = await import('@/services/takedown/blocklist');
			setBlocklistForTests([cachedRelease.hash]);
			setupProfile();
			mockRepository.getAllDebridUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getAllDebridOtherStreams = vi
				.fn()
				.mockResolvedValue([cachedRelease, otherStream]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt0113277' },
			});
			const res = createMockResponse();
			await handler(req, res);
			setBlocklistForTests([]);

			const urls = (res.json as Mock).mock.calls[0][0].streams.filter((s: any) => s.url);
			expect(urls).toHaveLength(1);
			expect(urls[0].url).toContain('/play/200:0');
		});

		it.each([0, 1, 2, 3, 4, 5])('respects otherStreamsLimit=%i', async (limit) => {
			setupProfile({ otherStreamsLimit: limit });
			mockRepository.getAllDebridUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getAllDebridOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getAllDebridOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				limit,
				undefined
			);
		});

		it('clamps an active sponsor’s otherStreamsLimit to 10', async () => {
			setupProfile({ otherStreamsLimit: 99 });
			activeCastGrant();
			mockRepository.getAllDebridUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getAllDebridOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getAllDebridOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				10,
				undefined
			);
		});

		it('clamps negative otherStreamsLimit to 0', async () => {
			setupProfile({ otherStreamsLimit: -3 });
			mockRepository.getAllDebridUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getAllDebridOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getAllDebridOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				0,
				undefined
			);
		});

		it('defaults otherStreamsLimit to 5 when null', async () => {
			setupProfile({ otherStreamsLimit: null });
			mockRepository.getAllDebridUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getAllDebridOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getAllDebridOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				5,
				undefined
			);
		});

		it('uses movieMaxSize for movies', async () => {
			setupProfile({ movieMaxSize: 15, episodeMaxSize: 3 });
			mockRepository.getAllDebridUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getAllDebridOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getAllDebridOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				5,
				15
			);
		});

		it('uses episodeMaxSize for shows', async () => {
			setupProfile({ movieMaxSize: 15, episodeMaxSize: 3 });
			mockRepository.getAllDebridUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getAllDebridOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'series', imdbid: 'tt111:1:2.json' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getAllDebridOtherStreams).toHaveBeenCalledWith(
				'tt111:1:2',
				'user1',
				5,
				3
			);
		});

		it('passes undefined maxSize when set to 0 (biggest available)', async () => {
			setupProfile({ movieMaxSize: 0, episodeMaxSize: 0 });
			mockRepository.getAllDebridUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getAllDebridOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getAllDebridOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				5,
				undefined
			);
		});

		it('hideCastOption hides the cast stream entry', async () => {
			setupProfile({ hideCastOption: true });
			mockRepository.getAllDebridUserCastStreams = vi.fn().mockResolvedValue([userStream]);
			mockRepository.getAllDebridOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			const payload = (res.json as Mock).mock.calls[0][0];
			const castOptionStream = payload.streams.find(
				(s: any) => s.externalUrl && s.name === 'DMM Cast AD ✨'
			);
			expect(castOptionStream).toBeUndefined();
			expect(payload.streams).toHaveLength(1); // only user stream
		});

		it('shows cast option when hideCastOption is false', async () => {
			setupProfile({ hideCastOption: false });
			mockRepository.getAllDebridUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getAllDebridOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			const payload = (res.json as Mock).mock.calls[0][0];
			const castOptionStream = payload.streams.find((s: any) => s.name === 'DMM Cast AD ✨');
			expect(castOptionStream).toBeDefined();
		});

		it('user streams are always returned regardless of maxSize settings', async () => {
			setupProfile({ movieMaxSize: 1 });
			mockRepository.getAllDebridUserCastStreams = vi.fn().mockResolvedValue([userStream]);
			mockRepository.getAllDebridOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getAllDebridUserCastStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				5
			);
			const payload = (res.json as Mock).mock.calls[0][0];
			const nonCastStreams = payload.streams.filter((s: any) => !s.externalUrl);
			expect(nonCastStreams).toHaveLength(1);
		});

		it('combines user and other streams correctly', async () => {
			setupProfile({ otherStreamsLimit: 2, movieMaxSize: 30 });
			mockRepository.getAllDebridUserCastStreams = vi.fn().mockResolvedValue([userStream]);
			mockRepository.getAllDebridOtherStreams = vi.fn().mockResolvedValue([otherStream]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getAllDebridUserCastStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				5
			);
			expect(mockRepository.getAllDebridOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				2,
				30
			);

			const payload = (res.json as Mock).mock.calls[0][0];
			// cast option + 1 user + 1 other = 3
			expect(payload.streams).toHaveLength(3);
		});

		it('skips AD user streams without magnetId/fileIndex', async () => {
			setupProfile();
			mockRepository.getAllDebridUserCastStreams = vi
				.fn()
				.mockResolvedValue([
					{ ...userStream, magnetId: null, fileIndex: null },
					userStream,
				]);
			mockRepository.getAllDebridOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			const payload = (res.json as Mock).mock.calls[0][0];
			const nonCastStreams = payload.streams.filter((s: any) => !s.externalUrl);
			// Only 1 stream (the one with magnetId/fileIndex), the null one is skipped
			expect(nonCastStreams).toHaveLength(1);
		});
	});
});
