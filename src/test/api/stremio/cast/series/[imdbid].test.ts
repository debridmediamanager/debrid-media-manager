import handler from '@/pages/api/stremio/cast/series/[imdbid]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
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

vi.mock('@/utils/castApiHelpers', () => ({
	generateUserId: mockGenerateUserId,
}));

vi.mock('@/utils/getStreamUrl', () => ({
	getStreamUrl: mockGetStreamUrl,
}));

describe('/api/stremio/cast/series/[imdbid]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerateUserId.mockResolvedValue('user-1');
	});

	it('validates required query params', async () => {
		const req = createMockRequest({ query: { imdbid: 'tt123', token: 'abc' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Missing "token", "hash" or "fileIds" query parameter',
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
			query: { imdbid: 'tt999', token: 'token', hash: 'hash', fileIds: '101' },
			headers: { 'x-real-ip': '1.1.1.1' },
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
				token: 'token',
				hash: 'hash',
				fileIds: ['201', '202'],
			},
			headers: { 'x-real-ip': '9.9.9.9' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockSaveCast).toHaveBeenCalledTimes(1);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ errorEpisodes: ['fileId:202'] });
	});
});
