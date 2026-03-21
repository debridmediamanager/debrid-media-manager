import handler from '@/pages/api/stremio-ad/[userid]/stream/[mediaType]/[imdbid]';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
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

	it('returns 500 when no profile exists', async () => {
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue(null);
		const req = createMockRequest({
			query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
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

		it('clamps otherStreamsLimit above 5 to 5', async () => {
			setupProfile({ otherStreamsLimit: 99 });
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
				(s: any) => s.externalUrl && s.name === 'DMM Cast AD✨'
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
			const castOptionStream = payload.streams.find((s: any) => s.name === 'DMM Cast AD✨');
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
