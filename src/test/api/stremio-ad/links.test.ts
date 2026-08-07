import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHelpers = vi.hoisted(() => ({
	resolveAllDebridUser: vi.fn(),
}));

const mockDb = vi.hoisted(() => ({
	fetchAllAllDebridCastedLinks: vi.fn(),
}));

vi.mock('@/utils/allDebridCastApiHelpers', () => mockHelpers);
vi.mock('@/services/repository', () => ({ repository: mockDb }));

import handler from '@/pages/api/stremio-ad/links';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('API /api/stremio-ad/links', () => {
	it('sets CORS header', async () => {
		const req = createMockRequest({ method: 'POST', body: {} });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
	});

	it('marks the response uncacheable so no proxy retains it', async () => {
		const req = createMockRequest({ method: 'POST', body: {} });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, private');
	});

	it('rejects GET so the api key cannot ride in the query string', async () => {
		const req = createMockRequest({ method: 'GET', query: { apiKey: 'leaky' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.setHeader).toHaveBeenCalledWith('Allow', ['POST']);
		expect(res._getStatusCode()).toBe(405);
		expect(mockHelpers.resolveAllDebridUser).not.toHaveBeenCalled();
	});

	it('returns 400 when apiKey is missing', async () => {
		const req = createMockRequest({ method: 'POST', body: {} });
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(400);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'Missing or invalid "apiKey" in request body',
		});
	});

	it('returns 400 when apiKey is not a string', async () => {
		const req = createMockRequest({ method: 'POST', body: { apiKey: ['a', 'b'] } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(400);
	});

	it('returns 401 when API key is invalid', async () => {
		mockHelpers.resolveAllDebridUser.mockResolvedValue({ valid: false });
		const req = createMockRequest({ method: 'POST', body: { apiKey: 'bad-key' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(401);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'Invalid AllDebrid API key',
		});
	});

	it('returns links after a single AllDebrid call', async () => {
		const links = [{ id: 1, url: 'http://example.com' }];
		mockHelpers.resolveAllDebridUser.mockResolvedValue({ valid: true, userId: 'user-123' });
		mockDb.fetchAllAllDebridCastedLinks.mockResolvedValue(links);
		const req = createMockRequest({ method: 'POST', body: { apiKey: 'valid-key' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockHelpers.resolveAllDebridUser).toHaveBeenCalledTimes(1);
		expect(mockHelpers.resolveAllDebridUser).toHaveBeenCalledWith('valid-key');
		expect(mockDb.fetchAllAllDebridCastedLinks).toHaveBeenCalledWith('user-123');
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ status: 'success', links });
	});

	it('returns 500 on error', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockHelpers.resolveAllDebridUser.mockRejectedValue(new Error('DB down'));
		const req = createMockRequest({ method: 'POST', body: { apiKey: 'valid-key' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'DB down',
		});
	});
});
