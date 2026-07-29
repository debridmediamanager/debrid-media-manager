import handler from '@/pages/api/stremio-tr/[userid]/stream/[mediaType]/[imdbid]';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import type { Mock } from 'vitest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');

const mockRepository = vi.mocked(repository);

describe('/api/stremio-tr/[userid]/stream/[mediaType]/[imdbid]', () => {
	const originalOrigin = process.env.DMM_ORIGIN;

	beforeEach(() => {
		process.env.DMM_ORIGIN = 'https://dmm.test';
		vi.clearAllMocks();
		mockRepository.getTorrinCastProfile = vi.fn();
		mockRepository.getTorrinUserCastStreams = vi.fn();
		mockRepository.getTorrinOtherStreams = vi.fn();
		mockRepository.getSnapshotsByHashes = vi.fn().mockResolvedValue([]);
	});

	afterAll(() => {
		process.env.DMM_ORIGIN = originalOrigin;
	});

	const setupProfile = (overrides: Record<string, unknown> = {}) => {
		mockRepository.getTorrinCastProfile = vi.fn().mockResolvedValue({
			baseUrl: 'https://tr.test',
			apiKey: 'tr-key',
			movieMaxSize: 0,
			episodeMaxSize: 0,
			otherStreamsLimit: 5,
			hideCastOption: false,
			...overrides,
		});
	};

	const userStream = {
		url: 'https://files.dmm.test/MyMovie.mkv',
		link: 'https://tr.test/d/aaa',
		hash: 'userhash1234',
		size: 5120,
		filename: 'MyMovie.mkv',
	};

	const otherStream = {
		url: 'https://files.dmm.test/OtherMovie.mkv',
		link: 'https://tr.test/d/bbb',
		hash: 'otherhash5678',
		size: 3072,
		filename: 'OtherMovie.mkv',
	};

	it('validates query parameters', async () => {
		const req = createMockRequest({ query: { userid: 'user', mediaType: 'movie' } });
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns 500 when no profile exists', async () => {
		mockRepository.getTorrinCastProfile = vi.fn().mockResolvedValue(null);
		const req = createMockRequest({
			query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
		});
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(500);
	});

	it('uses movieMaxSize for movies', async () => {
		setupProfile({ movieMaxSize: 15, episodeMaxSize: 3 });
		mockRepository.getTorrinUserCastStreams = vi.fn().mockResolvedValue([]);
		mockRepository.getTorrinOtherStreams = vi.fn().mockResolvedValue([]);
		const req = createMockRequest({
			query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
		});
		const res = createMockResponse();
		await handler(req, res);
		expect(mockRepository.getTorrinOtherStreams).toHaveBeenCalledWith(
			'tt111',
			'user1',
			'https://tr.test',
			5,
			15
		);
	});

	it('uses episodeMaxSize for shows and strips .json', async () => {
		setupProfile({ movieMaxSize: 15, episodeMaxSize: 3 });
		mockRepository.getTorrinUserCastStreams = vi.fn().mockResolvedValue([]);
		mockRepository.getTorrinOtherStreams = vi.fn().mockResolvedValue([]);
		const req = createMockRequest({
			query: { userid: 'user1', mediaType: 'series', imdbid: 'tt111:1:2.json' },
		});
		const res = createMockResponse();
		await handler(req, res);
		expect(mockRepository.getTorrinOtherStreams).toHaveBeenCalledWith(
			'tt111:1:2',
			'user1',
			'https://tr.test',
			5,
			3
		);
	});

	it('clamps otherStreamsLimit above 5 to 5', async () => {
		setupProfile({ otherStreamsLimit: 99 });
		mockRepository.getTorrinUserCastStreams = vi.fn().mockResolvedValue([]);
		mockRepository.getTorrinOtherStreams = vi.fn().mockResolvedValue([]);
		const req = createMockRequest({
			query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
		});
		const res = createMockResponse();
		await handler(req, res);
		expect(mockRepository.getTorrinOtherStreams).toHaveBeenCalledWith(
			'tt111',
			'user1',
			'https://tr.test',
			5,
			undefined
		);
	});

	it('hideCastOption hides the cast stream entry', async () => {
		setupProfile({ hideCastOption: true });
		mockRepository.getTorrinUserCastStreams = vi.fn().mockResolvedValue([userStream]);
		mockRepository.getTorrinOtherStreams = vi.fn().mockResolvedValue([]);
		const req = createMockRequest({
			query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
		});
		const res = createMockResponse();
		await handler(req, res);
		const payload = (res.json as Mock).mock.calls[0][0];
		const castOption = payload.streams.find((s: any) => s.name === 'DMM Cast TR✨');
		expect(castOption).toBeUndefined();
		expect(payload.streams).toHaveLength(1);
	});

	it('shows cast option when hideCastOption is false', async () => {
		setupProfile({ hideCastOption: false });
		mockRepository.getTorrinUserCastStreams = vi.fn().mockResolvedValue([]);
		mockRepository.getTorrinOtherStreams = vi.fn().mockResolvedValue([]);
		const req = createMockRequest({
			query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
		});
		const res = createMockResponse();
		await handler(req, res);
		const payload = (res.json as Mock).mock.calls[0][0];
		expect(payload.streams.find((s: any) => s.name === 'DMM Cast TR✨')).toBeDefined();
	});

	it('combines cast option, user, and other streams', async () => {
		setupProfile({ otherStreamsLimit: 2, movieMaxSize: 30 });
		mockRepository.getTorrinUserCastStreams = vi.fn().mockResolvedValue([userStream]);
		mockRepository.getTorrinOtherStreams = vi.fn().mockResolvedValue([otherStream]);
		const req = createMockRequest({
			query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
		});
		const res = createMockResponse();
		await handler(req, res);
		const payload = (res.json as Mock).mock.calls[0][0];
		expect(payload.streams).toHaveLength(3);
	});

	it('builds play URLs from the encoded link', async () => {
		setupProfile();
		mockRepository.getTorrinUserCastStreams = vi.fn().mockResolvedValue([userStream]);
		mockRepository.getTorrinOtherStreams = vi.fn().mockResolvedValue([]);
		const req = createMockRequest({
			query: { userid: 'user1', mediaType: 'movie', imdbid: 'tt111' },
		});
		const res = createMockResponse();
		await handler(req, res);
		const payload = (res.json as Mock).mock.calls[0][0];
		const playStream = payload.streams.find((s: any) => s.url);
		expect(playStream.url).toBe(
			`https://dmm.test/api/stremio-tr/user1/play/${encodeURIComponent(userStream.link)}`
		);
	});
});
