import handler from '@/pages/api/zurg/hashes-by-imdb';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');

const mockRepository = vi.mocked(repository);

const buildBody = (overrides: Record<string, unknown> = {}) => ({
	imdbId: 'tt1234567',
	...overrides,
});

const buildRequest = (bodyOverrides: Record<string, unknown> = {}) =>
	createMockRequest({
		method: 'POST',
		body: buildBody(bodyOverrides),
		headers: {
			'x-api-key': 'valid-api-key-123',
		},
	});

describe('POST /api/zurg/hashes-by-imdb', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRepository.validateZurgApiKey = vi.fn().mockResolvedValue(true);
		mockRepository.getHashesByImdbId = vi.fn().mockResolvedValue([]);
	});

	it('rejects non-POST methods', async () => {
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
	});

	it('requires x-api-key header', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: buildBody(),
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.json).toHaveBeenCalledWith({ error: 'Missing x-api-key header' });
	});

	it('rejects invalid API key', async () => {
		mockRepository.validateZurgApiKey = vi.fn().mockResolvedValue(false);
		const req = buildRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired API key' });
	});

	it('rejects invalid IMDB ID format', async () => {
		const req = buildRequest({ imdbId: 'invalid-id' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Invalid IMDB ID format. Expected format: ttXXXXXXX',
		});
	});

	it('clamps a limit above the ceiling instead of refusing it', async () => {
		const req = buildRequest({ limit: 101 });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockRepository.getHashesByImdbId).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 10 })
		);
	});

	it('caps a limit the old ceiling would have allowed', async () => {
		const req = buildRequest({ limit: 50 });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockRepository.getHashesByImdbId).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 10 })
		);
	});

	it('honours a limit below the ceiling', async () => {
		const req = buildRequest({ limit: 3 });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockRepository.getHashesByImdbId).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 3 })
		);
	});

	it('rejects a limit below one', async () => {
		const req = buildRequest({ limit: 0 });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Limit must be a number of at least 1',
		});
	});

	it('rejects a non-numeric limit', async () => {
		const req = buildRequest({ limit: '10' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Limit must be a number of at least 1',
		});
	});

	it('rejects when min > max in sizeFilters', async () => {
		const req = buildRequest({
			sizeFilters: { min: 50, max: 10 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'sizeFilters.min cannot be greater than sizeFilters.max',
		});
	});

	it('rejects substringFilters without blacklist or whitelist', async () => {
		const req = buildRequest({
			substringFilters: {},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'substringFilters must contain at least one of: blacklist or whitelist',
		});
	});

	it('returns hashes for valid request', async () => {
		const mockResults = [
			{
				hash: 'abc123def456',
				source: 'available' as const,
				filename: 'test-movie-1080p.mkv',
				size: 10737418240,
				sizeGB: 10,
				imdbId: 'tt1234567',
			},
			{
				hash: 'xyz789uvw012',
				source: 'cast' as const,
				filename: 'test-movie-720p.mp4',
				size: 5368709120,
				sizeGB: 5,
				imdbId: 'tt1234567',
			},
		];

		mockRepository.getHashesByImdbId = vi.fn().mockResolvedValue(mockResults);

		const req = buildRequest({ limit: 10 });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			hashes: mockResults,
			count: 2,
			sources: {
				available: 1,
				cast: 1,
				scraped: 0,
			},
		});

		expect(mockRepository.getHashesByImdbId).toHaveBeenCalledWith({
			imdbId: 'tt1234567',
			sizeFilters: undefined,
			substringFilters: undefined,
			limit: 10,
		});
	});

	it('applies size range filter correctly', async () => {
		const req = buildRequest({
			sizeFilters: { min: 5, max: 50 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockRepository.getHashesByImdbId).toHaveBeenCalledWith({
			imdbId: 'tt1234567',
			sizeFilters: { min: 5, max: 50 },
			substringFilters: undefined,
			limit: 10,
		});
	});

	it('applies min size filter only', async () => {
		const req = buildRequest({
			sizeFilters: { min: 10 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockRepository.getHashesByImdbId).toHaveBeenCalledWith({
			imdbId: 'tt1234567',
			sizeFilters: { min: 10, max: undefined },
			substringFilters: undefined,
			limit: 10,
		});
	});

	it('applies max size filter only', async () => {
		const req = buildRequest({
			sizeFilters: { max: 20 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockRepository.getHashesByImdbId).toHaveBeenCalledWith({
			imdbId: 'tt1234567',
			sizeFilters: { min: undefined, max: 20 },
			substringFilters: undefined,
			limit: 10,
		});
	});

	it('applies blacklist filter only', async () => {
		const req = buildRequest({
			substringFilters: {
				blacklist: ['CAM', 'TS'],
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockRepository.getHashesByImdbId).toHaveBeenCalledWith({
			imdbId: 'tt1234567',
			sizeFilters: undefined,
			substringFilters: {
				blacklist: ['CAM', 'TS'],
				whitelist: undefined,
			},
			limit: 10,
		});
	});

	it('applies whitelist filter only', async () => {
		const req = buildRequest({
			substringFilters: {
				whitelist: ['1080p', 'BluRay'],
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockRepository.getHashesByImdbId).toHaveBeenCalledWith({
			imdbId: 'tt1234567',
			sizeFilters: undefined,
			substringFilters: {
				blacklist: undefined,
				whitelist: ['1080p', 'BluRay'],
			},
			limit: 10,
		});
	});

	it('applies both blacklist and whitelist filters', async () => {
		const req = buildRequest({
			substringFilters: {
				blacklist: ['CAM', 'TS'],
				whitelist: ['1080p', 'BluRay'],
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockRepository.getHashesByImdbId).toHaveBeenCalledWith({
			imdbId: 'tt1234567',
			sizeFilters: undefined,
			substringFilters: {
				blacklist: ['CAM', 'TS'],
				whitelist: ['1080p', 'BluRay'],
			},
			limit: 10,
		});
	});

	it('applies all filters together', async () => {
		const req = buildRequest({
			sizeFilters: { min: 5, max: 50 },
			substringFilters: {
				blacklist: ['CAM', 'TS'],
				whitelist: ['1080p', 'BluRay'],
			},
			limit: 10,
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockRepository.getHashesByImdbId).toHaveBeenCalledWith({
			imdbId: 'tt1234567',
			sizeFilters: { min: 5, max: 50 },
			substringFilters: {
				blacklist: ['CAM', 'TS'],
				whitelist: ['1080p', 'BluRay'],
			},
			limit: 10,
		});
	});

	it('uses default limit when not provided', async () => {
		const req = buildRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockRepository.getHashesByImdbId).toHaveBeenCalledWith({
			imdbId: 'tt1234567',
			sizeFilters: undefined,
			substringFilters: undefined,
			limit: 10,
		});
	});
});
