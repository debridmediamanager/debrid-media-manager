import handler from '@/pages/api/stremio/cast/[imdbid]';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { generateUserId } from '@/utils/castApiHelpers';
import { getStreamUrl } from '@/utils/getStreamUrl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/getStreamUrl', () => ({
	getStreamUrl: vi.fn(),
}));
vi.mock('@/utils/castApiHelpers', async () => {
	const actual =
		await vi.importActual<typeof import('@/utils/castApiHelpers')>('@/utils/castApiHelpers');
	return {
		...actual,
		generateUserId: vi.fn(),
	};
});

const mockRepository = vi.mocked(repository);
const mockGetStreamUrl = vi.mocked(getStreamUrl);
const mockGenerateUserId = vi.mocked(generateUserId);

describe('/api/stremio/cast/[imdbid]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRepository.saveCast = vi.fn();
		mockGetStreamUrl.mockReset();
		mockGenerateUserId.mockResolvedValue('user-1');
	});

	it('validates required query parameters', async () => {
		const req = createMockRequest({ query: { imdbid: 'tt1' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Missing "token", "hash", "fileId" or "mediaType" parameter',
		});
	});

	it('rejects invalid parameter types', async () => {
		const req = createMockRequest({
			query: { imdbid: ['tt1'], token: 'a', hash: 'hash', fileId: '1', mediaType: 'movie' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Invalid "token", "hash", "fileId" or "mediaType" parameter',
		});
	});

	it('casts and saves stream metadata', async () => {
		mockGetStreamUrl.mockResolvedValue(['https://streams/100', 'https://rd/link', 1, 2, 123]);
		const req = createMockRequest({
			query: {
				imdbid: 'tt1234567',
				token: 'token',
				hash: 'hash',
				fileId: '10',
				mediaType: 'tv',
			},
			headers: { 'x-real-ip': '1.1.1.1' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGetStreamUrl).toHaveBeenCalledWith('token', 'hash', 10, '1.1.1.1', 'tv');
		expect(mockRepository.saveCast).toHaveBeenCalledWith(
			'tt1234567:1:2',
			'user-1',
			'hash',
			'https://streams/100',
			'https://rd/link',
			123
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.send).toHaveBeenCalledWith(expect.stringContaining('You can now stream'));
	});

	it('returns 500 when no stream url is available', async () => {
		mockGetStreamUrl.mockResolvedValue(['', '', -1, -1, 0]);
		const req = createMockRequest({
			query: {
				imdbid: 'tt123',
				token: 'token',
				hash: 'hash',
				fileId: '5',
				mediaType: 'movie',
			},
		});
		(req as any).socket = { remoteAddress: '2.2.2.2' };
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Failed to cast, no streamUrl',
		});
	});

	it('handles exceptions from stream helper', async () => {
		mockGetStreamUrl.mockRejectedValue(new Error('rd down'));
		const req = createMockRequest({
			query: {
				imdbid: 'tt123',
				token: 'token',
				hash: 'hash',
				fileId: '5',
				mediaType: 'movie',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: expect.stringContaining('Failed to cast:'),
		});
	});

	it('accepts token via Authorization Bearer header instead of query', async () => {
		mockGetStreamUrl.mockResolvedValue(['https://streams/100', 'https://rd/link', 1, 2, 123]);
		const req = createMockRequest({
			query: {
				imdbid: 'tt1234567',
				hash: 'hash',
				fileId: '10',
				mediaType: 'tv',
			},
			headers: {
				authorization: 'Bearer header-token',
				'x-real-ip': '1.1.1.1',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGenerateUserId).toHaveBeenCalledWith('header-token');
		expect(mockGetStreamUrl).toHaveBeenCalledWith('header-token', 'hash', 10, '1.1.1.1', 'tv');
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('returns 400 when no token is provided via any source', async () => {
		const req = createMockRequest({
			query: {
				imdbid: 'tt1',
				hash: 'hash',
				fileId: '1',
				mediaType: 'movie',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Missing "token", "hash", "fileId" or "mediaType" parameter',
		});
	});
});
