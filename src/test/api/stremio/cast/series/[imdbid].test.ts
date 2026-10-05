import handler from '@/pages/api/stremio/cast/series/[imdbid]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { RD_ADD_REFUSED_MESSAGE, RdAddPausedError } from '@/utils/rdAddPause';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSaveCast, mockGenerateUserId, mockGetStreamUrl } = vi.hoisted(() => ({
	mockSaveCast: vi.fn(),
	mockGenerateUserId: vi.fn(),
	mockGetStreamUrl: vi.fn(),
}));

vi.mock('@/services/repository', () => ({
	repository: {
		saveCast: mockSaveCast,
	},
}));

vi.mock('@/utils/castApiHelpers', async () => {
	const actual =
		await vi.importActual<typeof import('@/utils/castApiHelpers')>('@/utils/castApiHelpers');
	return {
		...actual,
		generateUserId: mockGenerateUserId,
	};
});

vi.mock('@/utils/getStreamUrl', () => ({
	getStreamUrl: mockGetStreamUrl,
}));

describe('/api/stremio/cast/series/[imdbid]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerateUserId.mockResolvedValue('user-1');
	});

	it('validates required query params', async () => {
		const req = createMockRequest({
			headers: { authorization: 'Bearer abc' },
			query: { imdbid: 'tt123' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Missing "token", "hash" or "fileIds" parameter',
		});
	});

	it('casts each requested file id and records success', async () => {
		mockGetStreamUrl.mockResolvedValue([
			'https://files.example.com/Video-S01E01.mkv',
			'https://rd.example.com/link',
			1,
			2,
			700,
		]);
		const req = createMockRequest({
			query: { imdbid: 'tt999', hash: 'hash', fileIds: '101' },
			headers: { authorization: 'Bearer token', 'x-real-ip': '1.1.1.1' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGetStreamUrl).toHaveBeenCalledWith('token', 'hash', 101, '1.1.1.1', 'tv');
		expect(mockSaveCast).toHaveBeenCalledWith(
			'tt999:1:2',
			'user-1',
			'hash',
			'https://files.example.com/Video-S01E01.mkv',
			'https://rd.example.com/link',
			700
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ errorEpisodes: [] });
	});

	// See the anime route: the bare imdb id is the movie key, so an episode
	// written there overwrites whatever else this torrent cast under it.
	it('records an error instead of writing an unparsed episode to the bare id', async () => {
		mockGetStreamUrl.mockResolvedValue([
			'https://files.example.com/Unnamed.mkv',
			'https://rd.example.com/link',
			-1,
			-1,
			700,
		]);
		const req = createMockRequest({
			query: { imdbid: 'tt999', hash: 'hash', fileIds: '101' },
			headers: { authorization: 'Bearer token', 'x-real-ip': '1.1.1.1' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockSaveCast).not.toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith({
			errorEpisodes: ['fileId:101 (no episode number in filename)'],
		});
	});

	it('accepts token via Authorization Bearer header instead of query', async () => {
		mockGetStreamUrl.mockResolvedValue([
			'https://files.example.com/Video-S01E01.mkv',
			'https://rd.example.com/link',
			1,
			2,
			700,
		]);
		const req = createMockRequest({
			query: { imdbid: 'tt999', hash: 'hash', fileIds: '101' },
			headers: {
				authorization: 'Bearer header-token',
				'x-real-ip': '1.1.1.1',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGenerateUserId).toHaveBeenCalledWith('header-token');
		expect(mockGetStreamUrl).toHaveBeenCalledWith('header-token', 'hash', 101, '1.1.1.1', 'tv');
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ errorEpisodes: [] });
	});

	it('returns 400 when no token is provided via any source', async () => {
		const req = createMockRequest({
			query: { imdbid: 'tt1', hash: 'hash', fileIds: '1' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Missing "token", "hash" or "fileIds" parameter',
		});
	});

	it('tracks episodes that fail to cast', async () => {
		mockGetStreamUrl
			.mockResolvedValueOnce([
				'https://files.example.com/Video-S01E01.mkv',
				'https://rd.link/1',
				1,
				1,
				600,
			])
			.mockRejectedValueOnce(new Error('rd offline'));

		const req = createMockRequest({
			query: {
				imdbid: 'tt777',
				hash: 'hash',
				fileIds: ['201', '202'],
			},
			headers: { authorization: 'Bearer token', 'x-real-ip': '9.9.9.9' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockSaveCast).toHaveBeenCalledTimes(1);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ errorEpisodes: ['fileId:202'] });
	});

	// Every file is the same torrent added again, so once RD has refused the
	// add twice the rest would only be refused too: report them unsent with the
	// reason rather than make each one wait out a pause of its own.
	it('stops at a paused Real-Debrid add and says why', async () => {
		mockGetStreamUrl
			.mockResolvedValueOnce(['https://stream/1', 'https://rd/1', 1, 1, 100])
			.mockRejectedValueOnce(new RdAddPausedError());
		const req = createMockRequest({
			headers: { authorization: 'Bearer abc', 'x-real-ip': '1.1.1.1' },
			query: { imdbid: 'tt123', hash: 'h', fileIds: ['1', '2', '3', '4'] },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGetStreamUrl).toHaveBeenCalledTimes(2);
		expect(mockSaveCast).toHaveBeenCalledTimes(1);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			errorEpisodes: ['fileId:2', 'fileId:3', 'fileId:4'],
			errorMessage: RD_ADD_REFUSED_MESSAGE,
		});
	});
});
