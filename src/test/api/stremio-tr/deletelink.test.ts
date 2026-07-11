import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHelpers = vi.hoisted(() => ({
	validateTorrinApiKey: vi.fn(),
	generateTorrinUserId: vi.fn(),
}));

const mockDb = vi.hoisted(() => ({
	deleteTorrinCastedLink: vi.fn(),
}));

vi.mock('@/utils/torrinCastApiHelpers', () => mockHelpers);
vi.mock('@/services/repository', () => ({ repository: mockDb }));

import handler from '@/pages/api/stremio-tr/deletelink';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

beforeEach(() => {
	vi.clearAllMocks();
});

const validBody = {
	baseUrl: 'https://tr.test',
	apiKey: 'valid-key',
	imdbId: 'tt123',
	hash: 'abc',
};

describe('API /api/stremio-tr/deletelink', () => {
	it('sets CORS header', async () => {
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
	});

	it('returns 405 for non-DELETE methods', async () => {
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.setHeader).toHaveBeenCalledWith('Allow', ['DELETE']);
		expect(res._getStatusCode()).toBe(405);
	});

	it('returns 400 when creds are missing', async () => {
		const req = createMockRequest({
			method: 'DELETE',
			body: { imdbId: 'tt1', hash: 'abc' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(400);
	});

	it('returns 400 when imdbId or hash is missing', async () => {
		const req = createMockRequest({
			method: 'DELETE',
			body: { baseUrl: 'https://tr.test', apiKey: 'valid-key' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(400);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'Missing or invalid "imdbId" or "hash" in request body',
		});
	});

	it('returns 401 when credentials are invalid', async () => {
		mockHelpers.validateTorrinApiKey.mockResolvedValue({ valid: false });
		const req = createMockRequest({ method: 'DELETE', body: validBody });
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(401);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'Invalid Torrin credentials',
		});
	});

	it('deletes the link on success', async () => {
		mockHelpers.validateTorrinApiKey.mockResolvedValue({ valid: true });
		mockHelpers.generateTorrinUserId.mockResolvedValue('tr-user-456');
		mockDb.deleteTorrinCastedLink.mockResolvedValue(undefined);
		const req = createMockRequest({ method: 'DELETE', body: validBody });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockDb.deleteTorrinCastedLink).toHaveBeenCalledWith('tt123', 'tr-user-456', 'abc');
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({
			status: 'success',
			message: 'Link deleted successfully',
		});
	});

	it('returns 500 on error', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockHelpers.validateTorrinApiKey.mockRejectedValue(new Error('DB down'));
		const req = createMockRequest({ method: 'DELETE', body: validBody });
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'DB down',
		});
	});
});
