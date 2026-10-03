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

const HASH = '0123456789abcdef0123456789abcdef01234567';
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('/api/stremio/cast/[imdbid]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRepository.saveCast = vi.fn();
		mockGetStreamUrl.mockReset();
		mockGenerateUserId.mockResolvedValue('user-1');
	});

	it('validates required parameters', async () => {
		const req = createMockRequest({ query: { imdbid: 'tt1' }, headers: bearer('token') });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Missing "hash", "fileId" or "mediaType" parameter',
		});
	});

	it('rejects invalid parameter types', async () => {
		const req = createMockRequest({
			query: { imdbid: ['tt1'], hash: 'hash', fileId: '1', mediaType: 'movie' },
			headers: bearer('a'),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Invalid "hash", "fileId" or "mediaType" parameter',
		});
	});

	it('casts and saves stream metadata, answering with the Stremio link', async () => {
		mockGetStreamUrl.mockResolvedValue(['https://streams/100', 'https://rd/link', 1, 2, 123]);
		const req = createMockRequest({
			query: { imdbid: 'tt1234567', hash: 'hash', fileId: '10', mediaType: 'tv' },
			headers: { ...bearer('header-token'), 'x-real-ip': '1.1.1.1' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGenerateUserId).toHaveBeenCalledWith('header-token');
		expect(mockGetStreamUrl).toHaveBeenCalledWith('header-token', 'hash', 10, '1.1.1.1', 'tv');
		expect(mockRepository.saveCast).toHaveBeenCalledWith(
			'tt1234567:1:2',
			'user-1',
			'hash',
			'https://streams/100',
			'https://rd/link',
			123
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			status: 'success',
			redirectUrl: 'stremio:///detail/series/tt1234567/tt1234567:1:2',
			message: 'You can now stream S1E2 in Stremio',
		});
	});

	it('answers a movie with the movie link', async () => {
		mockGetStreamUrl.mockResolvedValue(['https://streams/100', 'https://rd/link', -1, -1, 123]);
		const req = createMockRequest({
			query: { imdbid: 'tt1234567', hash: 'hash', fileId: '10', mediaType: 'movie' },
			headers: { ...bearer('header-token'), 'x-real-ip': '1.1.1.1' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.saveCast).toHaveBeenCalledWith(
			'tt1234567',
			'user-1',
			'hash',
			'https://streams/100',
			'https://rd/link',
			123
		);
		expect(res.json).toHaveBeenCalledWith({
			status: 'success',
			redirectUrl: 'stremio:///detail/movie/tt1234567/tt1234567',
			message: 'You can now stream the movie in Stremio',
		});
	});

	it('returns 500 when no stream url is available', async () => {
		mockGetStreamUrl.mockResolvedValue(['', '', -1, -1, 0]);
		const req = createMockRequest({
			query: { imdbid: 'tt123', hash: 'hash', fileId: '5', mediaType: 'movie' },
			headers: bearer('token'),
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
			query: { imdbid: 'tt123', hash: 'hash', fileId: '5', mediaType: 'movie' },
			headers: bearer('token'),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: expect.stringContaining('Failed to cast:'),
		});
	});

	it('returns 401 when no key is sent', async () => {
		const req = createMockRequest({
			query: { imdbid: 'tt1', hash: 'hash', fileId: '1', mediaType: 'movie' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(mockGetStreamUrl).not.toHaveBeenCalled();
	});

	// Card 210. The info window's per-file Cast was a GET form, so the key rode
	// in `?token=` - the exact parameter order below is what that form emitted
	// and what dmm-01's access log holds. Nothing but that form ever sent it,
	// so the route refuses it outright instead of quietly honouring a leak.
	describe('a key in the query string', () => {
		const legacyQuery = {
			imdbid: 'tt1234567',
			token: 'RDKEYFROMTHEOLDFORM',
			hash: HASH,
			fileId: '3',
			mediaType: 'movie',
		};

		it('is refused without being used', async () => {
			mockGetStreamUrl.mockResolvedValue(['https://streams/1', 'https://rd/1', -1, -1, 1]);
			const req = createMockRequest({ query: legacyQuery });
			const res = createMockResponse();

			await handler(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
			expect(mockGetStreamUrl).not.toHaveBeenCalled();
			expect(mockGenerateUserId).not.toHaveBeenCalled();
			expect(mockRepository.saveCast).not.toHaveBeenCalled();
			expect(JSON.stringify(res._getData())).not.toContain('RDKEYFROMTHEOLDFORM');
		});

		it('is refused even alongside a header', async () => {
			const req = createMockRequest({ query: legacyQuery, headers: bearer('header-token') });
			const res = createMockResponse();

			await handler(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
			expect(mockGetStreamUrl).not.toHaveBeenCalled();
		});
	});
});
