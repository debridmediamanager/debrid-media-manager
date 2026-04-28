import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHelpers = vi.hoisted(() => ({
	validateTorBoxApiKey: vi.fn(),
	generateTorBoxUserId: vi.fn(),
}));

const mockDb = vi.hoisted(() => ({
	fetchAllTorBoxCastedLinks: vi.fn(),
}));

vi.mock('@/utils/torboxCastApiHelpers', () => mockHelpers);
vi.mock('@/services/repository', () => ({ repository: mockDb }));

import handler from '@/pages/api/stremio-tb/links';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('API /api/stremio-tb/links', () => {
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

	it('returns 400 when apiKey is missing', async () => {
		const req = createMockRequest({ method: 'GET', query: {} });
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(400);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'Missing or invalid "apiKey" query parameter',
		});
	});

	it('returns 400 when apiKey is not a string', async () => {
		const req = createMockRequest({ method: 'GET', query: { apiKey: ['a', 'b'] } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(400);
	});

	it('returns 401 when API key is invalid', async () => {
		mockHelpers.validateTorBoxApiKey.mockResolvedValue({ valid: false });
		const req = createMockRequest({ method: 'GET', query: { apiKey: 'bad-key' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(401);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'Invalid TorBox API key',
		});
	});

	it('returns links on success', async () => {
		const links = [{ id: 1, url: 'http://example.com' }];
		mockHelpers.validateTorBoxApiKey.mockResolvedValue({ valid: true });
		mockHelpers.generateTorBoxUserId.mockResolvedValue('tb-user-456');
		mockDb.fetchAllTorBoxCastedLinks.mockResolvedValue(links);
		const req = createMockRequest({ method: 'GET', query: { apiKey: 'valid-key' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockHelpers.generateTorBoxUserId).toHaveBeenCalledWith('valid-key');
		expect(mockDb.fetchAllTorBoxCastedLinks).toHaveBeenCalledWith('tb-user-456');
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ status: 'success', links });
	});

	it('returns 500 on error', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockHelpers.validateTorBoxApiKey.mockRejectedValue(new Error('DB down'));
		const req = createMockRequest({ method: 'GET', query: { apiKey: 'valid-key' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'DB down',
		});
	});
});
