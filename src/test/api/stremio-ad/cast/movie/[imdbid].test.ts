import handler from '@/pages/api/stremio-ad/cast/movie/[imdbid]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerateUserId, mockSaveCast } = vi.hoisted(() => ({
	mockGenerateUserId: vi.fn(),
	mockSaveCast: vi.fn(),
}));

vi.mock('@/utils/allDebridCastApiHelpers', () => ({
	generateAllDebridUserId: mockGenerateUserId,
}));

vi.mock('@/services/repository', () => ({
	repository: { saveAllDebridCast: mockSaveCast },
}));

const validBody = {
	apiKey: 'ad-key',
	hash: 'e7d4d6a669459da1e0a554b2e867d1cb97b6a00d',
	magnetId: 12345,
	fileIndex: 2,
	streamUrl: 'https://alldebrid.com/dl/abcdef',
	filename: 'Movie.2024.2160p.mkv',
	fileSize: 2048,
};

describe('/api/stremio-ad/cast/movie/[imdbid]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerateUserId.mockResolvedValue('ad-user-1');
		mockSaveCast.mockResolvedValue(undefined);
	});

	it('rejects non-POST', async () => {
		const req = createMockRequest({ method: 'GET', query: { imdbid: 'tt1' } });
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(405);
	});

	it('returns 400 when fields are missing', async () => {
		const req = createMockRequest({
			method: 'POST',
			query: { imdbid: 'tt1' },
			body: { apiKey: 'k' },
		});
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('saves cast with client-supplied metadata and does not call AD', async () => {
		const req = createMockRequest({
			method: 'POST',
			query: { imdbid: 'tt1' },
			body: validBody,
		});
		const res = createMockResponse();
		await handler(req, res);

		expect(mockGenerateUserId).toHaveBeenCalledWith('ad-key');
		expect(mockSaveCast).toHaveBeenCalledWith(
			'tt1',
			'ad-user-1',
			validBody.hash,
			validBody.filename,
			validBody.streamUrl,
			validBody.fileSize,
			validBody.magnetId,
			validBody.fileIndex
		);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('returns 500 when userId generation fails', async () => {
		mockGenerateUserId.mockRejectedValue(new Error('bad key'));
		const req = createMockRequest({
			method: 'POST',
			query: { imdbid: 'tt1' },
			body: validBody,
		});
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(500);
	});
});
