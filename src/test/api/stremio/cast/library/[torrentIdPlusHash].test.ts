import handler from '@/pages/api/stremio/cast/library/[torrentIdPlusHash]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockGetTorrentInfo,
	mockDbGetIMDBIdByHash,
	mockDbSaveCast,
	mockDbSaveIMDBIdMapping,
	mockGenerateUserId,
} = vi.hoisted(() => ({
	mockGetTorrentInfo: vi.fn(),
	mockDbGetIMDBIdByHash: vi.fn(),
	mockDbSaveCast: vi.fn(),
	mockDbSaveIMDBIdMapping: vi.fn(),
	mockGenerateUserId: vi.fn(),
}));

vi.mock('@/services/realDebrid', () => ({
	getTorrentInfo: mockGetTorrentInfo,
}));

vi.mock('@/services/repository', () => ({
	repository: {
		getIMDBIdByHash: mockDbGetIMDBIdByHash,
		saveCast: mockDbSaveCast,
		saveIMDBIdMapping: mockDbSaveIMDBIdMapping,
	},
}));

vi.mock('@/utils/castApiHelpers', () => ({
	generateUserId: mockGenerateUserId,
}));

const makeTorrentInfo = (overrides: Partial<any> = {}) => ({
	hash: 'hash123',
	filename: 'Movie.2024',
	files: [
		{ id: 1, path: 'Movie.2024.mkv', bytes: 1048576, selected: true },
		{ id: 2, path: 'EpisodeTitle.mkv', bytes: 2097152, selected: true },
	],
	links: ['https://rd/link-1', 'https://rd/link-2'],
	original_filename: 'Movie.2024',
	original_bytes: 4096,
	...overrides,
});

describe('/api/stremio/cast/library/[torrentIdPlusHash]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerateUserId.mockResolvedValue('user-1');
		mockDbGetIMDBIdByHash.mockResolvedValue('tt1234567');
		mockGetTorrentInfo.mockResolvedValue(makeTorrentInfo());
		mockDbSaveIMDBIdMapping.mockResolvedValue(undefined);
	});

	it('validates rdToken', async () => {
		const req = createMockRequest({ query: { torrentIdPlusHash: '1:hash' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Missing or invalid RD token',
		});
	});

	it('validates torrentIdPlusHash', async () => {
		const req = createMockRequest({ query: { rdToken: 'token' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Missing or invalid torrentid',
		});
	});

	it('requires selected files to match RD links', async () => {
		mockGetTorrentInfo.mockResolvedValue(
			makeTorrentInfo({
				files: [{ id: 1, path: 'Movie.mkv', bytes: 1, selected: true }],
				links: ['https://rd/link-1', 'https://rd/link-2'],
			})
		);

		const req = createMockRequest({ query: { rdToken: 'token', torrentIdPlusHash: '1:hash' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Cannot determine file link',
		});
	});

	it('saves casts when imdb id exists in the database', async () => {
		const req = createMockRequest({ query: { rdToken: 'token', torrentIdPlusHash: '1:hash' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGetTorrentInfo).toHaveBeenCalledWith('token', '1', true);
		expect(mockDbSaveCast).toHaveBeenCalledWith(
			'tt1234567',
			'user-1',
			'hash123',
			'Movie.2024.mkv',
			'https://rd/link-1',
			1
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			status: 'success',
			redirectUrl: 'stremio://detail/movie/tt1234567/tt1234567',
			imdbId: 'tt1234567',
			mediaType: 'movie',
			season: undefined,
			episode: undefined,
		});
	});

	it('returns need_imdb_id when imdb id is not in database and not provided', async () => {
		mockDbGetIMDBIdByHash.mockResolvedValue(null);

		const req = createMockRequest({ query: { rdToken: 'token', torrentIdPlusHash: '1:hash' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			status: 'need_imdb_id',
			torrentInfo: {
				title: 'Movie.2024',
				filename: 'Movie.2024',
				hash: 'hash123',
				files: [
					{ path: 'Movie.2024.mkv', bytes: 1048576 },
					{ path: 'EpisodeTitle.mkv', bytes: 2097152 },
				],
			},
		});
	});

	it('saves imdb id mapping and processes cast when user provides valid imdb id', async () => {
		mockDbGetIMDBIdByHash.mockResolvedValue(null);

		const req = createMockRequest({
			query: { rdToken: 'token', torrentIdPlusHash: '1:hash', imdbId: 'tt7654321' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockDbSaveIMDBIdMapping).toHaveBeenCalledWith('hash123', 'tt7654321');
		expect(mockDbSaveCast).toHaveBeenCalledWith(
			'tt7654321',
			'user-1',
			'hash123',
			'Movie.2024.mkv',
			'https://rd/link-1',
			1
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			status: 'success',
			redirectUrl: 'stremio://detail/movie/tt7654321/tt7654321',
			imdbId: 'tt7654321',
			mediaType: 'movie',
			season: undefined,
			episode: undefined,
		});
	});

	it('validates imdb id format when user provides it', async () => {
		mockDbGetIMDBIdByHash.mockResolvedValue(null);

		const req = createMockRequest({
			query: { rdToken: 'token', torrentIdPlusHash: '1:hash', imdbId: 'invalid' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Invalid IMDB ID format. Expected format: tt1234567',
		});
	});

	it('returns 500 when generateUserId fails', async () => {
		mockGenerateUserId.mockRejectedValue(new Error('Invalid token'));
		const req = createMockRequest({ query: { rdToken: 'token', torrentIdPlusHash: '1:hash' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage:
				'Failed to generate user ID from RD token. Please check your RD token is valid.',
			details: 'Invalid token',
		});
	});

	it('returns 500 when database lookup fails', async () => {
		mockDbGetIMDBIdByHash.mockRejectedValue(new Error('Database connection error'));
		const req = createMockRequest({ query: { rdToken: 'token', torrentIdPlusHash: '1:hash' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Database error: Failed to retrieve IMDB ID from hash',
			details: 'Database connection error',
		});
	});

	it('returns 500 when database save fails', async () => {
		mockDbSaveCast.mockRejectedValue(new Error('db down'));
		const req = createMockRequest({ query: { rdToken: 'token', torrentIdPlusHash: '1:hash' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Database error: Failed to save cast information',
			details: 'db down',
		});
	});
});
