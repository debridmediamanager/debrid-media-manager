import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHelpers = vi.hoisted(() => ({
	validateTorrinApiKey: vi.fn(),
	generateTorrinUserId: vi.fn(),
}));

const mockDb = vi.hoisted(() => ({
	fetchAllTorrinCastedLinks: vi.fn(),
}));

vi.mock('@/utils/torrinCastApiHelpers', () => mockHelpers);
vi.mock('@/services/repository', () => ({ repository: mockDb }));

import handler from '@/pages/api/stremio-tr/links';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

beforeEach(() => {
	vi.clearAllMocks();
});

const validQuery = { baseUrl: 'https://tr.test', apiKey: 'valid-key' };

describe('API /api/stremio-tr/links', () => {
	it('sets CORS header', async () => {
		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
	});

	it('returns 405 for non-GET methods', async () => {
		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.setHeader).toHaveBeenCalledWith('Allow', ['GET']);
		expect(res._getStatusCode()).toBe(405);
	});

	it('returns 400 when creds are missing', async () => {
		const req = createMockRequest({ method: 'GET', query: {} });
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(400);
	});

	it('returns 400 when apiKey is not a string', async () => {
		const req = createMockRequest({
			method: 'GET',
			query: { baseUrl: 'https://tr.test', apiKey: ['a', 'b'] },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(400);
	});

	it('returns 401 when credentials are invalid', async () => {
		mockHelpers.validateTorrinApiKey.mockResolvedValue({ valid: false });
		const req = createMockRequest({
			method: 'GET',
			query: { baseUrl: 'https://tr.test', apiKey: 'bad-key' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(401);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'Invalid Torrin credentials',
		});
	});

	it('returns links on success', async () => {
		const links = [{ imdbId: 'tt1', url: 'http://example.com' }];
		mockHelpers.validateTorrinApiKey.mockResolvedValue({ valid: true });
		mockHelpers.generateTorrinUserId.mockResolvedValue('tr-user-456');
		mockDb.fetchAllTorrinCastedLinks.mockResolvedValue(links);
		const req = createMockRequest({ method: 'GET', query: validQuery });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockHelpers.generateTorrinUserId).toHaveBeenCalledWith(
			'https://tr.test',
			'valid-key'
		);
		expect(mockDb.fetchAllTorrinCastedLinks).toHaveBeenCalledWith('tr-user-456');
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ status: 'success', links });
	});

	it('returns 500 on error', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockHelpers.validateTorrinApiKey.mockRejectedValue(new Error('DB down'));
		const req = createMockRequest({ method: 'GET', query: validQuery });
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'DB down',
		});
	});
});
