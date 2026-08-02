import handler from '@/pages/api/stremio-tr/cast/movie/[imdbid]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSaveCast, mockGenerateUserId, mockGetBiggestFile } = vi.hoisted(() => ({
	mockSaveCast: vi.fn(),
	mockGenerateUserId: vi.fn(),
	mockGetBiggestFile: vi.fn(),
}));

vi.mock('@/services/repository', () => ({
	repository: {
		saveTorrinCast: mockSaveCast,
	},
}));

vi.mock('@/utils/torrinCastApiHelpers', () => ({
	generateTorrinUserId: mockGenerateUserId,
}));

vi.mock('@/utils/getTorrinStreamUrl', () => ({
	getBiggestFileTorrinStreamUrl: mockGetBiggestFile,
}));

const creds = { baseUrl: 'https://tr.test', apiKey: 'tr-key' };

describe('/api/stremio-tr/cast/movie/[imdbid]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('validates required parameters', async () => {
		const req = createMockRequest({ query: { imdbid: 'tt123', ...creds } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('grabs the biggest file, saves the cast, and returns success', async () => {
		mockGenerateUserId.mockResolvedValue('tr-user-1');
		mockGetBiggestFile.mockResolvedValue([
			'https://files.example.com/Video.mkv',
			'https://tr.test/d/link',
			900,
		]);

		const req = createMockRequest({
			query: { imdbid: 'tt1234567', hash: 'hashabc', ...creds },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGetBiggestFile).toHaveBeenCalledWith('https://tr.test', 'tr-key', 'hashabc');
		expect(mockGenerateUserId).toHaveBeenCalledWith('https://tr.test', 'tr-key');
		expect(mockSaveCast).toHaveBeenCalledWith(
			'tt1234567',
			'tr-user-1',
			'hashabc',
			'https://files.example.com/Video.mkv',
			'https://tr.test/d/link',
			900,
			'https://tr.test'
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			status: 'success',
			message: 'You can now stream the movie in Stremio',
			filename: 'Video.mkv',
		});
	});

	it('returns 500 when no streamable file is found', async () => {
		mockGetBiggestFile.mockResolvedValue(['', '', 0]);
		const req = createMockRequest({
			query: { imdbid: 'tt1', hash: 'hashabc', ...creds },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(mockSaveCast).not.toHaveBeenCalled();
	});

	it('returns 500 when stream acquisition throws', async () => {
		mockGetBiggestFile.mockRejectedValue(new Error('tr offline'));
		const req = createMockRequest({
			query: { imdbid: 'tt7654321', hash: 'hashabc', ...creds },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Failed to cast the movie',
		});
	});
});
