import { languageEmojis } from '@/components/showInfo/languages';
import handler from '@/pages/api/stremio/[userid]/stream/[mediaType]/[imdbid]';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { isLegacyToken } from '@/utils/castApiHelpers';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/castApiHelpers', () => ({
	isLegacyToken: vi.fn(),
}));

const mockRepository = vi.mocked(repository);
const mockIsLegacyToken = vi.mocked(isLegacyToken);

describe('/api/stremio/[userid]/stream/[mediaType]/[imdbid]', () => {
	const originalOrigin = process.env.DMM_ORIGIN;

	beforeEach(() => {
		process.env.DMM_ORIGIN = 'https://dmm.test';
		vi.clearAllMocks();
		mockRepository.getCastProfile = vi.fn();
		mockRepository.getCastURLs = vi.fn();
		mockRepository.getOtherCastURLs = vi.fn();
		mockRepository.getUserCastStreams = vi.fn();
		mockRepository.getOtherStreams = vi.fn();
		mockRepository.getSnapshotsByHashes = vi.fn();
		mockIsLegacyToken.mockReturnValue(false);
	});

	afterAll(() => {
		process.env.DMM_ORIGIN = originalOrigin;
	});

	it('validates query parameters', async () => {
		const req = createMockRequest({ query: { userid: 'user', mediaType: 'movie' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Invalid "userid", "imdbid" or "mediaType" query parameter',
		});
	});

	it('sets CORS headers on all responses', async () => {
		const testCases = [
			{
				name: 'invalid params',
				query: { userid: 'user', mediaType: 'movie' },
			},
			{
				name: 'OPTIONS',
				method: 'OPTIONS',
				query: { userid: 'user', mediaType: 'movie', imdbid: 'tt123' },
			},
			{
				name: 'legacy token',
				setup: () => mockIsLegacyToken.mockReturnValue(true),
				query: { userid: 'short', mediaType: 'movie', imdbid: 'tt123' },
			},
			{
				name: 'missing profile',
				setup: () => mockRepository.getCastProfile.mockResolvedValue(null),
				query: { userid: 'user', mediaType: 'movie', imdbid: 'tt123' },
			},
		];

		for (const testCase of testCases) {
			vi.clearAllMocks();
			mockIsLegacyToken.mockReturnValue(false);
			mockRepository.getCastProfile = vi.fn();
			mockRepository.getCastURLs = vi.fn();
			mockRepository.getOtherCastURLs = vi.fn();

			testCase.setup?.();

			const req = createMockRequest({
				query: testCase.query,
				method: testCase.method || 'GET',
			});
			const res = createMockResponse();

			await handler(req, res);

			expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
		}
	});

	it('supports OPTIONS preflight', async () => {
		const req = createMockRequest({
			method: 'OPTIONS',
			query: { userid: 'user', mediaType: 'movie', imdbid: 'tt123' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('prompts update when legacy tokens are used', async () => {
		mockIsLegacyToken.mockReturnValue(true);
		const req = createMockRequest({
			query: { userid: 'short', mediaType: 'movie', imdbid: 'tt123' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				streams: expect.arrayContaining([
					expect.objectContaining({
						name: '⚠️ Update Required',
					}),
				]),
			})
		);
	});

	it('returns 500 when no cast profile exists', async () => {
		mockRepository.getCastProfile = vi.fn().mockResolvedValue(null);
		const req = createMockRequest({
			query: { userid: 'user123', mediaType: 'movie', imdbid: 'tt123' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Failed to get Real-Debrid profile for user user123',
		});
	});

	it('serves cast streams for shows', async () => {
		mockRepository.getCastProfile = vi.fn().mockResolvedValue({
			clientId: 'id',
			clientSecret: 'secret',
			refreshToken: 'refresh',
			movieMaxSize: 10,
			episodeMaxSize: 3,
			otherStreamsLimit: 5,
		});
		mockRepository.getUserCastStreams = vi.fn().mockResolvedValue([
			{
				url: 'https://files.dmm.test/My%20Show%20S01E01.mkv',
				link: 'https://app.real-debrid.com/d/abcdefghijklmnopqrstuvwxyz',
				size: 2048,
				filename: 'My Show S01E01.mkv',
				hash: 'abc123',
			},
		]);
		mockRepository.getOtherStreams = vi.fn().mockResolvedValue([
			{
				url: 'https://files.dmm.test/Other.mkv',
				link: 'https://app.real-debrid.com/d/abcdefghijklmnopqrstuvwxyz123',
				size: 512,
				filename: 'Other.mkv',
				hash: 'def456',
			},
		]);
		mockRepository.getSnapshotsByHashes = vi.fn().mockResolvedValue([]);

		const req = createMockRequest({
			query: {
				userid: 'user123',
				mediaType: 'show',
				imdbid: 'tt7654321:2:3.json',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		const payload = (res.json as Mock).mock.calls[0][0] as {
			streams: Array<{ name: string; title: string; url?: string; externalUrl?: string }>;
		};
		expect(payload.streams).toHaveLength(3);
		const userStream = payload.streams.find((s) => s.title.includes('🎬 DMM Cast RD (Yours)'));
		expect(userStream).toBeDefined();
		expect(mockRepository.getOtherStreams).toHaveBeenCalledWith(
			'tt7654321:2:3',
			'user123',
			5,
			3
		);
	});

	it('returns 500 when cast URLs retrieval fails', async () => {
		mockRepository.getCastProfile = vi.fn().mockResolvedValue({
			clientId: 'id',
			clientSecret: 'secret',
			refreshToken: 'refresh',
			movieMaxSize: 10,
			episodeMaxSize: 3,
			otherStreamsLimit: 5,
		});
		mockRepository.getUserCastStreams = vi.fn().mockRejectedValue(new Error('db'));

		const req = createMockRequest({
			query: {
				userid: 'user123',
				mediaType: 'movie',
				imdbid: 'tt7654321',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Failed to get casted URLs' });
	});

	it('generates stream names based on resolution, codec and size', async () => {
		mockRepository.getCastProfile = vi.fn().mockResolvedValue({
			clientId: 'id',
			clientSecret: 'secret',
			refreshToken: 'refresh',
			movieMaxSize: 10,
			episodeMaxSize: 3,
			otherStreamsLimit: 5,
		});
		mockRepository.getUserCastStreams = vi.fn().mockResolvedValue([
			{
				url: 'https://files.dmm.test/Movie.2024.2160p.mkv',
				link: 'https://app.real-debrid.com/d/abcdefghijklmnopqrstuvwxyz',
				size: 20480,
				filename: 'Movie.2024.2160p.mkv',
				hash: 'abcdef1234567890abcdef1234567890abcdef12',
			},
		]);
		mockRepository.getOtherStreams = vi.fn().mockResolvedValue([]);
		mockRepository.getSnapshotsByHashes = vi.fn().mockResolvedValue([
			{
				id: 'abcdef1234567890abcdef1234567890abcdef12:2024-01-01',
				hash: 'abcdef1234567890abcdef1234567890abcdef12',
				addedDate: new Date('2024-01-01'),
				payload: {
					MediaInfo: {
						streams: [
							{
								codec_type: 'video',
								codec_name: 'hevc',
								width: 3840,
								height: 2160,
							},
						],
					},
				},
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		]);

		const req = createMockRequest({
			query: {
				userid: 'user123',
				mediaType: 'movie',
				imdbid: 'tt123456',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		const payload = (res.json as Mock).mock.calls[0][0] as {
			streams: Array<{ name: string; title: string }>;
		};

		const stream = payload.streams.find((s) => s.title.includes('Movie.2024.2160p.mkv'));
		expect(stream).toBeDefined();
		expect(stream?.name).toBe('4K • HEVC • 20.00 GB');
	});

	it('enriches streams with metadata from snapshots', async () => {
		mockRepository.getCastProfile = vi.fn().mockResolvedValue({
			clientId: 'id',
			clientSecret: 'secret',
			refreshToken: 'refresh',
			movieMaxSize: 10,
			episodeMaxSize: 3,
			otherStreamsLimit: 5,
		});
		mockRepository.getUserCastStreams = vi.fn().mockResolvedValue([
			{
				url: 'https://files.dmm.test/Movie.2024.2160p.mkv',
				link: 'https://app.real-debrid.com/d/abcdefghijklmnopqrstuvwxyz',
				size: 20480,
				filename: 'Movie.2024.2160p.mkv',
				hash: 'abcdef1234567890abcdef1234567890abcdef12',
			},
		]);
		mockRepository.getOtherStreams = vi.fn().mockResolvedValue([]);
		mockRepository.getSnapshotsByHashes = vi.fn().mockResolvedValue([
			{
				id: 'abcdef1234567890abcdef1234567890abcdef12:2024-01-01',
				hash: 'abcdef1234567890abcdef1234567890abcdef12',
				addedDate: new Date('2024-01-01'),
				payload: {
					MediaInfo: {
						streams: [
							{
								codec_type: 'video',
								codec_name: 'hevc',
								width: 3840,
								height: 2160,
								side_data_list: [{ dv_profile: 5 }],
							},
							{
								codec_type: 'audio',
								codec_name: 'eac3',
								channels: 6,
								tags: { language: 'eng' },
							},
							{
								codec_type: 'audio',
								codec_name: 'aac',
								channels: 2,
								tags: { language: 'jpn' },
							},
						],
					},
				},
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		]);

		const req = createMockRequest({
			query: {
				userid: 'user123',
				mediaType: 'movie',
				imdbid: 'tt123456',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		const payload = (res.json as Mock).mock.calls[0][0] as {
			streams: Array<{ title: string }>;
		};

		const stream = payload.streams.find((s) => s.title.includes('Movie.2024.2160p.mkv'));
		expect(stream).toBeDefined();
		expect(stream?.title).toContain('DD+');
		expect(stream?.title).toContain(languageEmojis.eng);
		expect(stream?.title).toContain(languageEmojis.jpn);
		expect(stream?.title).toContain('🎬 DMM Cast RD (Yours)');
	});

	it('handles missing snapshots gracefully', async () => {
		mockRepository.getCastProfile = vi.fn().mockResolvedValue({
			clientId: 'id',
			clientSecret: 'secret',
			refreshToken: 'refresh',
			movieMaxSize: 10,
			episodeMaxSize: 3,
			otherStreamsLimit: 5,
		});
		mockRepository.getUserCastStreams = vi.fn().mockResolvedValue([
			{
				url: 'https://files.dmm.test/Movie.mkv',
				link: 'https://app.real-debrid.com/d/abcdefghijklmnopqrstuvwxyz',
				size: 2048,
				filename: 'Movie.mkv',
				hash: 'unknownhash1234567890unknownhash12345678',
			},
		]);
		mockRepository.getOtherStreams = vi.fn().mockResolvedValue([]);
		mockRepository.getSnapshotsByHashes = vi.fn().mockResolvedValue([]);

		const req = createMockRequest({
			query: {
				userid: 'user123',
				mediaType: 'movie',
				imdbid: 'tt123456',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		const payload = (res.json as Mock).mock.calls[0][0] as {
			streams: Array<{ title: string }>;
		};

		const stream = payload.streams.find((s) => s.title.includes('Movie.mkv'));
		expect(stream).toBeDefined();
		expect(stream?.title).toContain('🎬 DMM Cast RD (Yours)');
	});

	describe('settings behavior', () => {
		const setupProfile = (overrides: Record<string, unknown> = {}) => {
			mockRepository.getCastProfile = vi.fn().mockResolvedValue({
				clientId: 'id',
				clientSecret: 'secret',
				refreshToken: 'refresh',
				movieMaxSize: 0,
				episodeMaxSize: 0,
				otherStreamsLimit: 5,
				hideCastOption: false,
				...overrides,
			});
		};

		const userStream = {
			url: 'https://files.dmm.test/MyMovie.mkv',
			link: 'https://app.real-debrid.com/d/abcdefghijklm',
			size: 5120,
			filename: 'MyMovie.mkv',
			hash: 'userhash1234',
		};

		const otherStream = {
			url: 'https://files.dmm.test/OtherMovie.mkv',
			link: 'https://app.real-debrid.com/d/zyxwvutsrqpon',
			size: 3072,
			filename: 'OtherMovie.mkv',
			hash: 'otherhash5678',
		};

		beforeEach(() => {
			mockRepository.getSnapshotsByHashes = vi.fn().mockResolvedValue([]);
		});

		it('otherStreamsLimit does not affect user cast streams', async () => {
			setupProfile({ otherStreamsLimit: 0 });
			mockRepository.getUserCastStreams = vi.fn().mockResolvedValue([userStream]);
			mockRepository.getOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			// getUserCastStreams always called with limit 5
			expect(mockRepository.getUserCastStreams).toHaveBeenCalledWith('tt111', 'user1', 5);
			// otherStreamsLimit 0 passed to getOtherStreams
			expect(mockRepository.getOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				0,
				undefined
			);

			const payload = (res.json as Mock).mock.calls[0][0];
			// cast option + 1 user stream = 2 (no other streams)
			const nonCastStreams = payload.streams.filter((s: any) => !s.externalUrl);
			expect(nonCastStreams).toHaveLength(1);
			expect(nonCastStreams[0].title).toContain('MyMovie.mkv');
		});

		it('passes otherStreamsLimit to getOtherStreams query', async () => {
			setupProfile({ otherStreamsLimit: 3 });
			mockRepository.getUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				3,
				undefined
			);
		});

		it.each([0, 1, 2, 3, 4, 5])('respects otherStreamsLimit=%i', async (limit) => {
			setupProfile({ otherStreamsLimit: limit });
			mockRepository.getUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				limit,
				undefined
			);
		});

		it('clamps otherStreamsLimit above 5 to 5', async () => {
			setupProfile({ otherStreamsLimit: 99 });
			mockRepository.getUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				5,
				undefined
			);
		});

		it('clamps negative otherStreamsLimit to 0', async () => {
			setupProfile({ otherStreamsLimit: -3 });
			mockRepository.getUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				0,
				undefined
			);
		});

		it('defaults otherStreamsLimit to 5 when null/undefined', async () => {
			setupProfile({ otherStreamsLimit: null });
			mockRepository.getUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				5,
				undefined
			);
		});

		it('uses movieMaxSize for movies', async () => {
			setupProfile({ movieMaxSize: 15, episodeMaxSize: 3 });
			mockRepository.getUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getOtherStreams).toHaveBeenCalledWith('tt111', 'user1', 5, 15);
		});

		it('uses episodeMaxSize for shows', async () => {
			setupProfile({ movieMaxSize: 15, episodeMaxSize: 3 });
			mockRepository.getUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'series', imdbid: 'tt111:1:2.json' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getOtherStreams).toHaveBeenCalledWith('tt111:1:2', 'user1', 5, 3);
		});

		it('passes undefined maxSize when movieMaxSize is 0 (biggest available)', async () => {
			setupProfile({ movieMaxSize: 0 });
			mockRepository.getUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				5,
				undefined
			);
		});

		it('passes undefined maxSize when episodeMaxSize is 0 (biggest available)', async () => {
			setupProfile({ episodeMaxSize: 0 });
			mockRepository.getUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'series', imdbid: 'tt111:1:1.json' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getOtherStreams).toHaveBeenCalledWith(
				'tt111:1:1',
				'user1',
				5,
				undefined
			);
		});

		it('hideCastOption hides the cast stream entry', async () => {
			setupProfile({ hideCastOption: true });
			mockRepository.getUserCastStreams = vi.fn().mockResolvedValue([userStream]);
			mockRepository.getOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			const payload = (res.json as Mock).mock.calls[0][0];
			const castOptionStream = payload.streams.find(
				(s: any) => s.externalUrl && s.name === 'DMM Cast RD✨'
			);
			expect(castOptionStream).toBeUndefined();
			// user stream still present
			expect(payload.streams).toHaveLength(1);
		});

		it('shows cast option when hideCastOption is false', async () => {
			setupProfile({ hideCastOption: false });
			mockRepository.getUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			const payload = (res.json as Mock).mock.calls[0][0];
			const castOptionStream = payload.streams.find((s: any) => s.name === 'DMM Cast RD✨');
			expect(castOptionStream).toBeDefined();
		});

		it('user streams are always returned regardless of maxSize settings', async () => {
			// movieMaxSize=1 but user stream is 5GB — should still appear
			setupProfile({ movieMaxSize: 1 });
			mockRepository.getUserCastStreams = vi.fn().mockResolvedValue([userStream]); // 5120 MB
			mockRepository.getOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			// getUserCastStreams called with hardcoded 5, no maxSize param
			expect(mockRepository.getUserCastStreams).toHaveBeenCalledWith('tt111', 'user1', 5);
			const payload = (res.json as Mock).mock.calls[0][0];
			const nonCastStreams = payload.streams.filter((s: any) => !s.externalUrl);
			expect(nonCastStreams).toHaveLength(1);
		});

		it('combines user and other streams correctly', async () => {
			setupProfile({ otherStreamsLimit: 2, movieMaxSize: 30 });
			mockRepository.getUserCastStreams = vi.fn().mockResolvedValue([userStream]);
			mockRepository.getOtherStreams = vi.fn().mockResolvedValue([otherStream]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getUserCastStreams).toHaveBeenCalledWith('tt111', 'user1', 5);
			expect(mockRepository.getOtherStreams).toHaveBeenCalledWith('tt111', 'user1', 2, 30);

			const payload = (res.json as Mock).mock.calls[0][0];
			// cast option + 1 user + 1 other = 3
			expect(payload.streams).toHaveLength(3);

			const yourStream = payload.streams.find((s: any) =>
				s.behaviorHints?.bingeGroup?.includes(':yours')
			);
			const otherResultStream = payload.streams.find((s: any) =>
				s.behaviorHints?.bingeGroup?.includes(':other:')
			);
			expect(yourStream).toBeDefined();
			expect(otherResultStream).toBeDefined();
		});
	});

	it('fetches snapshots for unique hashes only', async () => {
		mockRepository.getCastProfile = vi.fn().mockResolvedValue({
			clientId: 'id',
			clientSecret: 'secret',
			refreshToken: 'refresh',
			movieMaxSize: 10,
			episodeMaxSize: 3,
			otherStreamsLimit: 5,
		});
		mockRepository.getUserCastStreams = vi.fn().mockResolvedValue([
			{
				url: 'https://files.dmm.test/File1.mkv',
				link: 'https://app.real-debrid.com/d/link1',
				size: 1024,
				filename: 'File1.mkv',
				hash: 'samehash12345678901234567890samehash1234',
			},
			{
				url: 'https://files.dmm.test/File2.mkv',
				link: 'https://app.real-debrid.com/d/link2',
				size: 1024,
				filename: 'File2.mkv',
				hash: 'samehash12345678901234567890samehash1234',
			},
		]);
		mockRepository.getOtherStreams = vi.fn().mockResolvedValue([
			{
				url: 'https://files.dmm.test/File3.mkv',
				link: 'https://app.real-debrid.com/d/link3',
				size: 1024,
				filename: 'File3.mkv',
				hash: 'differenthash90123456789differenthash901',
			},
		]);
		mockRepository.getSnapshotsByHashes = vi.fn().mockResolvedValue([]);

		const req = createMockRequest({
			query: {
				userid: 'user123',
				mediaType: 'movie',
				imdbid: 'tt123456',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.getSnapshotsByHashes).toHaveBeenCalledWith([
			'samehash12345678901234567890samehash1234',
			'differenthash90123456789differenthash901',
		]);
	});
});
