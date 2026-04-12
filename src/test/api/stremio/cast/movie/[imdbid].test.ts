import handler from '@/pages/api/stremio/cast/movie/[imdbid]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSaveCast, mockGenerateUserId, mockGetBiggestFileStreamUrl } = vi.hoisted(() => ({
	mockSaveCast: vi.fn(),
	mockGenerateUserId: vi.fn(),
	mockGetBiggestFileStreamUrl: vi.fn(),
}));

vi.mock('@/services/repository', () => ({
	repository: {
		saveCast: mockSaveCast,
	},
}));

vi.mock('@/utils/castApiHelpers', () => ({
	extractToken: vi.fn(
		(req: { query: Record<string, string>; headers: Record<string, string> }) => {
			const auth = req.headers?.authorization;
			if (auth && auth.toLowerCase().startsWith('bearer ')) return auth.substring(7).trim();
			return req.query?.token ?? null;
		}
	),
	generateUserId: mockGenerateUserId,
}));

vi.mock('@/utils/getStreamUrl', () => ({
	getBiggestFileStreamUrl: mockGetBiggestFileStreamUrl,
}));

describe('/api/stremio/cast/movie/[imdbid]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('validates required query parameters', async () => {
		const req = createMockRequest({ query: { imdbid: 'tt123', token: 'abc' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Missing "token" or "hash" parameter',
		});
	});

	it('unrestricts the biggest RD file and saves it to the repository', async () => {
		mockGenerateUserId.mockResolvedValue('user-1');
		mockGetBiggestFileStreamUrl.mockResolvedValue([
			'https://files.example.com/Video.mkv',
			'https://rd.example.com/link',
			900,
		]);

		const req = createMockRequest({
			query: { imdbid: 'tt1234567', token: 'token-abc', hash: 'hashabc' },
			headers: { 'x-real-ip': '127.0.0.1' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGenerateUserId).toHaveBeenCalledWith('token-abc');
		expect(mockGetBiggestFileStreamUrl).toHaveBeenCalledWith(
			'token-abc',
			'hashabc',
			'127.0.0.1'
		);
		expect(mockSaveCast).toHaveBeenCalledWith(
			'tt1234567',
			'user-1',
			'hashabc',
			'https://files.example.com/Video.mkv',
			'https://rd.example.com/link',
			900
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			status: 'success',
			message: 'You can now stream the movie in Stremio',
			filename: 'Video.mkv',
		});
	});

	it('returns 500 when stream url acquisition fails', async () => {
		mockGetBiggestFileStreamUrl.mockRejectedValue(new Error('rd offline'));

		const req = createMockRequest({
			query: { imdbid: 'tt7654321', token: 'token-abc', hash: 'hashabc' },
			headers: { 'x-real-ip': '10.0.0.2' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'rd offline',
		});
	});
});
