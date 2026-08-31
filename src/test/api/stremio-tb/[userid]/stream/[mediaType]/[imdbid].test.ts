import handler from '@/pages/api/stremio-tb/[userid]/stream/[mediaType]/[imdbid]';
import { repository } from '@/services/repository';
import { checkCachedStatus } from '@/services/torbox';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/torbox');

const mockRepository = vi.mocked(repository);
const mockCheckCachedStatus = vi.mocked(checkCachedStatus);

describe('/api/stremio-tb/[userid]/stream/[mediaType]/[imdbid]', () => {
	const originalOrigin = process.env.DMM_ORIGIN;

	beforeEach(() => {
		process.env.DMM_ORIGIN = 'https://dmm.test';
		vi.clearAllMocks();
		mockRepository.getTorBoxCastProfile = vi.fn();
		mockRepository.getTorBoxUserCastStreams = vi.fn();
		mockRepository.getTorBoxOtherStreams = vi.fn();
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
		mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue(null);
		const req = createMockRequest({
			query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
	});

	describe('settings behavior', () => {
		const setupProfile = (overrides: Record<string, unknown> = {}) => {
			mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({
				apiKey: 'tb-key',
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
			torrentId: 100,
			fileId: 1,
		};

		const otherStream = {
			url: 'https://files.dmm.test/OtherMovie.mkv',
			hash: 'otherhash5678',
			size: 3072,
			filename: 'OtherMovie.mkv',
			torrentId: 200,
			fileId: 2,
		};

		it('drops other users web downloads, which this key cannot resolve', async () => {
			setupProfile();
			const otherWebDownload = {
				...otherStream,
				// md5 hash — a TorBox web download, private to its own account
				hash: 'd41d8cd98f00b204e9800998ecf8427e',
				url: 'https://files.dmm.test/TheirWebDownload.mkv',
			};
			mockRepository.getTorBoxUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getTorBoxOtherStreams = vi
				.fn()
				.mockResolvedValue([otherStream, otherWebDownload]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			const payload = (res.json as Mock).mock.calls[0][0];
			const urls = payload.streams.filter((s: any) => s.url).map((s: any) => s.url);
			expect(urls).toHaveLength(1);
			expect(urls[0]).toContain('/play/200:2');
		});

		it('keeps a users own web download cast', async () => {
			setupProfile();
			mockRepository.getTorBoxUserCastStreams = vi.fn().mockResolvedValue([
				{
					...userStream,
					hash: 'd41d8cd98f00b204e9800998ecf8427e',
				},
			]);
			mockRepository.getTorBoxOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			const payload = (res.json as Mock).mock.calls[0][0];
			const urls = payload.streams.filter((s: any) => s.url).map((s: any) => s.url);
			expect(urls).toHaveLength(1);
			expect(urls[0]).toContain('h=d41d8cd98f00b204e9800998ecf8427e');
		});

		it('otherStreamsLimit does not affect user cast streams', async () => {
			setupProfile({ otherStreamsLimit: 0 });
			mockRepository.getTorBoxUserCastStreams = vi.fn().mockResolvedValue([userStream]);
			mockRepository.getTorBoxOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getTorBoxUserCastStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				5
			);
			expect(mockRepository.getTorBoxOtherStreams).toHaveBeenCalledWith(
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
			mockRepository.getTorBoxUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getTorBoxOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getTorBoxOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				limit,
				undefined
			);
		});

		it('clamps otherStreamsLimit above the sponsor ceiling to 10', async () => {
			setupProfile({ otherStreamsLimit: 99 });
			mockRepository.getTorBoxUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getTorBoxOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getTorBoxOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				10,
				undefined
			);
		});

		it('clamps negative otherStreamsLimit to 0', async () => {
			setupProfile({ otherStreamsLimit: -3 });
			mockRepository.getTorBoxUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getTorBoxOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getTorBoxOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				0,
				undefined
			);
		});

		it('defaults otherStreamsLimit to 5 when null', async () => {
			setupProfile({ otherStreamsLimit: null });
			mockRepository.getTorBoxUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getTorBoxOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getTorBoxOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				5,
				undefined
			);
		});

		it('uses movieMaxSize for movies', async () => {
			setupProfile({ movieMaxSize: 15, episodeMaxSize: 3 });
			mockRepository.getTorBoxUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getTorBoxOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getTorBoxOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				5,
				15
			);
		});

		it('uses episodeMaxSize for shows', async () => {
			setupProfile({ movieMaxSize: 15, episodeMaxSize: 3 });
			mockRepository.getTorBoxUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getTorBoxOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'series', imdbid: 'tt111:1:2.json' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getTorBoxOtherStreams).toHaveBeenCalledWith(
				'tt111:1:2',
				'user1',
				5,
				3
			);
		});

		it('passes undefined maxSize when set to 0 (biggest available)', async () => {
			setupProfile({ movieMaxSize: 0, episodeMaxSize: 0 });
			mockRepository.getTorBoxUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getTorBoxOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getTorBoxOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				5,
				undefined
			);
		});

		it('hideCastOption hides the cast stream entry', async () => {
			setupProfile({ hideCastOption: true });
			mockRepository.getTorBoxUserCastStreams = vi.fn().mockResolvedValue([userStream]);
			mockRepository.getTorBoxOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			const payload = (res.json as Mock).mock.calls[0][0];
			const castOptionStream = payload.streams.find(
				(s: any) => s.externalUrl && s.name === 'DMM Cast TB✨'
			);
			expect(castOptionStream).toBeUndefined();
			expect(payload.streams).toHaveLength(1); // only user stream
		});

		it('shows cast option when hideCastOption is false', async () => {
			setupProfile({ hideCastOption: false });
			mockRepository.getTorBoxUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getTorBoxOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			const payload = (res.json as Mock).mock.calls[0][0];
			const castOptionStream = payload.streams.find((s: any) => s.name === 'DMM Cast TB✨');
			expect(castOptionStream).toBeDefined();
		});

		it('user streams are always returned regardless of maxSize settings', async () => {
			setupProfile({ movieMaxSize: 1 });
			mockRepository.getTorBoxUserCastStreams = vi.fn().mockResolvedValue([userStream]);
			mockRepository.getTorBoxOtherStreams = vi.fn().mockResolvedValue([]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getTorBoxUserCastStreams).toHaveBeenCalledWith(
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
			mockRepository.getTorBoxUserCastStreams = vi.fn().mockResolvedValue([userStream]);
			mockRepository.getTorBoxOtherStreams = vi.fn().mockResolvedValue([otherStream]);

			const req = createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
			});
			const res = createMockResponse();
			await handler(req, res);

			expect(mockRepository.getTorBoxUserCastStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				5
			);
			expect(mockRepository.getTorBoxOtherStreams).toHaveBeenCalledWith(
				'tt111',
				'user1',
				2,
				30
			);

			const payload = (res.json as Mock).mock.calls[0][0];
			// cast option + 1 user + 1 other = 3
			expect(payload.streams).toHaveLength(3);
		});
	});

	// A TorBox torrent id only resolves inside the account that created it, so
	// the play route needs to know whose row it is handing over.
	it("marks the caster's own streams so play can use the torrent id", async () => {
		mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({
			movieMaxSize: 0,
			episodeMaxSize: 0,
			otherStreamsLimit: 5,
		});
		mockRepository.getTorBoxUserCastStreams = vi.fn().mockResolvedValue([
			{
				url: 'Mine.mkv',
				filename: 'Mine.mkv',
				size: 100,
				hash: 'a'.repeat(40),
				torrentId: 1,
				fileId: 2,
			},
		]);
		mockRepository.getTorBoxOtherStreams = vi.fn().mockResolvedValue([
			{
				url: 'Theirs.mkv',
				filename: 'Theirs.mkv',
				size: 100,
				hash: 'b'.repeat(40),
				torrentId: 3,
				fileId: 4,
			},
		]);
		mockRepository.getSnapshotsByHashes = vi.fn().mockResolvedValue([]);

		const req = createMockRequest({
			query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt123' },
		});
		const res = createMockResponse();
		await handler(req, res);

		const urls = (res._getData() as any).streams.map((s: any) => s.url).filter(Boolean);
		expect(urls.find((u: string) => u.includes('/1:2'))).toContain('own=1');
		expect(urls.find((u: string) => u.includes('/3:4'))).not.toContain('own=1');
	});

	// The scraped pool behind the detail page: every release for the title,
	// offered once TorBox's checkcached confirms the hash. Casts are not probed
	// - unchanged behaviour - and a probe failure costs only the trove streams.
	describe('cached trove releases', () => {
		const T1 = '1'.repeat(40);
		const T2 = '2'.repeat(40);
		const T3 = '3'.repeat(40);
		const trove = [
			{ hash: T1, title: 'Movie.2026.2160p.WEB-DL', fileSize: 55000 },
			{ hash: T2, title: 'Movie.2026.DOCU.1080p', fileSize: 4000 },
			{ hash: T3, title: 'Movie.2026.1080p.WEB-DL', fileSize: 19000 },
		];

		const setup = (overrides: Record<string, unknown> = {}) => {
			mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({
				apiKey: 'tb-key',
				movieMaxSize: 0,
				episodeMaxSize: 0,
				otherStreamsLimit: 5,
				hideCastOption: false,
				...overrides,
			});
		};

		const requestTrove = () =>
			createMockRequest({
				query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt12042730' },
			});

		it('offers cache-confirmed releases in the slots other casts leave open', async () => {
			setup();
			mockRepository.getTorBoxUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getTorBoxOtherStreams = vi.fn().mockResolvedValue([
				{
					url: 'https://files.dmm.test/OtherMovie.mkv',
					hash: 'otherhash5678',
					size: 3072,
					filename: 'OtherMovie.mkv',
					torrentId: 200,
					fileId: 2,
				},
			]);
			mockRepository.getAllScrapedTrueResults = vi.fn().mockResolvedValue(trove);
			mockCheckCachedStatus.mockResolvedValue({
				success: true,
				data: { [T1]: { id: 1 }, [T3]: { id: 3 } },
			} as any);

			const res = createMockResponse();
			await handler(requestTrove(), res);

			const payload = (res.json as Mock).mock.calls[0][0];
			const urls: string[] = payload.streams.filter((s: any) => s.url).map((s: any) => s.url);
			// One other-user cast plus the two cached releases; the uncached one
			// is never offered. A bare hash, no torrent ids or filename.
			expect(urls).toHaveLength(3);
			expect(urls).toContain(`https://dmm.test/api/stremio-tb/user1/play/${T1}`);
			expect(urls).toContain(`https://dmm.test/api/stremio-tb/user1/play/${T3}`);
			expect(urls.some((url) => url.includes(T2))).toBe(false);
			expect(mockRepository.getAllScrapedTrueResults).toHaveBeenCalledWith(
				'movie:tt12042730'
			);
		});

		it('skips trove entirely when the probe fails, leaving casts untouched', async () => {
			setup();
			mockRepository.getTorBoxUserCastStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getTorBoxOtherStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getAllScrapedTrueResults = vi.fn().mockResolvedValue(trove);
			mockCheckCachedStatus.mockRejectedValue(new Error('torbox down'));

			const res = createMockResponse();
			await handler(requestTrove(), res);

			const payload = (res.json as Mock).mock.calls[0][0];
			expect(payload.streams.filter((s: any) => s.url)).toEqual([]);
			expect(res.status).not.toHaveBeenCalledWith(500);
		});

		it('never sends cast hashes to the probe', async () => {
			setup();
			mockRepository.getTorBoxUserCastStreams = vi.fn().mockResolvedValue([
				{
					url: 'https://files.dmm.test/MyMovie.mkv',
					hash: 'userhash1234',
					size: 5120,
					filename: 'MyMovie.mkv',
					torrentId: 100,
					fileId: 1,
				},
			]);
			mockRepository.getTorBoxOtherStreams = vi.fn().mockResolvedValue([]);
			mockRepository.getAllScrapedTrueResults = vi.fn().mockResolvedValue(trove);
			mockCheckCachedStatus.mockResolvedValue({ success: true, data: {} } as any);

			const res = createMockResponse();
			await handler(requestTrove(), res);

			const probed = (mockCheckCachedStatus.mock.calls[0]?.[0] as any)?.hash as string[];
			// Size-descending: the probe sees the biggest releases first.
			expect(probed).toEqual([T1, T3, T2]);
		});
	});
});
