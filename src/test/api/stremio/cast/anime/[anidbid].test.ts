import handler from '@/pages/api/stremio/cast/anime/[anidbid]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerateUserId, mockSaveCast, mockGetStreamUrl } = vi.hoisted(() => ({
	mockGenerateUserId: vi.fn(),
	mockSaveCast: vi.fn(),
	mockGetStreamUrl: vi.fn(),
}));

vi.mock('@/utils/castApiHelpers', async () => {
	const actual =
		await vi.importActual<typeof import('@/utils/castApiHelpers')>('@/utils/castApiHelpers');
	return {
		...actual,
		generateUserId: mockGenerateUserId,
	};
});

vi.mock('@/services/repository', () => ({
	repository: {
		saveCast: mockSaveCast,
	},
}));

vi.mock('@/utils/getStreamUrl', () => ({
	getStreamUrl: mockGetStreamUrl,
}));

describe('/api/stremio/cast/anime/[anidbid]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerateUserId.mockResolvedValue('user-1');
		mockGetStreamUrl.mockResolvedValue([
			'https://stream/video.mkv',
			'https://rd/link',
			1,
			2,
			700,
		]);
	});

	it('validates required query params', async () => {
		const req = createMockRequest({ query: { anidbid: 'anidb1', token: 'tok' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Missing "token", "hash" or "fileIds" parameter',
		});
	});

	it('validates query param types', async () => {
		const req = createMockRequest({
			query: { anidbid: ['anidb1'] as any, token: 'tok', hash: 'hash', fileIds: '1' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Invalid "token", "hash" or "fileIds" parameter',
		});
	});

	it('saves casted anime streams for each requested file id', async () => {
		const req = createMockRequest({
			query: { anidbid: 'anidb1', token: 'tok', hash: 'hash', fileIds: ['101'] },
			headers: { 'x-real-ip': '127.0.0.1' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGetStreamUrl).toHaveBeenCalledWith('tok', 'hash', 101, '127.0.0.1', 'anime');
		expect(mockSaveCast).toHaveBeenCalledWith(
			'anidb1:1:2',
			'user-1',
			'hash',
			'https://stream/video.mkv',
			'https://rd/link',
			700
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ errorEpisodes: [] });
	});

	it('records failed episodes when stream acquisition errors occur', async () => {
		mockGetStreamUrl.mockRejectedValueOnce(new Error('rd down'));
		const req = createMockRequest({
			query: { anidbid: 'anidb1', token: 'tok', hash: 'hash', fileIds: ['201'] },
			headers: { 'x-real-ip': '10.0.0.5' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith({ errorEpisodes: ['fileId:201'] });
	});
});
