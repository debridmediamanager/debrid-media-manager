import handler from '@/pages/api/stremio/[userid]/catalog/movie/casted-movies.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchCastedMovies, mockIsLegacyToken } = vi.hoisted(() => ({
	mockFetchCastedMovies: vi.fn(),
	mockIsLegacyToken: vi.fn(),
}));

vi.mock('@/services/repository', () => ({
	repository: {
		fetchCastedMovies: mockFetchCastedMovies,
	},
}));

vi.mock('@/utils/castApiHelpers', () => ({
	isLegacyToken: mockIsLegacyToken,
}));

vi.mock('@/services/database/mdblistCache', () => ({
	getMdblistCacheService: () => ({ getTitles: vi.fn().mockResolvedValue(new Map()) }),
}));

describe('/api/stremio/[userid]/catalog/movie/casted-movies.json', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsLegacyToken.mockReturnValue(false);
	});

	it('validates userid parameter', async () => {
		const req = createMockRequest({ query: { userid: ['abc'] as any } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Invalid "userid" query parameter',
		});
	});

	it('responds to OPTIONS requests early', async () => {
		const req = createMockRequest({ method: 'OPTIONS', query: { userid: 'user' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockFetchCastedMovies).not.toHaveBeenCalled();
	});

	it('returns update notice for legacy tokens', async () => {
		mockIsLegacyToken.mockReturnValue(true);
		const req = createMockRequest({ query: { userid: 'abcde' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockFetchCastedMovies).not.toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith({
			metas: [
				expect.objectContaining({
					id: 'dmm-update-required',
					type: 'movie',
				}),
			],
			cacheMaxAge: 0,
		});
	});

	it('maps repository results into Stremio metas', async () => {
		mockFetchCastedMovies.mockResolvedValue(['tt100', 'tt200']);
		const req = createMockRequest({ query: { userid: 'user123' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockFetchCastedMovies).toHaveBeenCalledWith('user123');
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			metas: [
				{
					id: 'tt100',
					name: 'tt100',
					type: 'movie',
					poster: 'https://images.metahub.space/poster/small/tt100/img',
				},
				{
					id: 'tt200',
					name: 'tt200',
					type: 'movie',
					poster: 'https://images.metahub.space/poster/small/tt200/img',
				},
			],
			cacheMaxAge: 0,
		});
	});
});
