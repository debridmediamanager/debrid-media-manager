import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHelpers = vi.hoisted(() => ({
	validateTorBoxApiKey: vi.fn(),
	generateTorBoxUserId: vi.fn(),
}));

const mockDb = vi.hoisted(() => ({
	deleteTorBoxCastedLink: vi.fn(),
}));

vi.mock('@/utils/torboxCastApiHelpers', () => mockHelpers);
vi.mock('@/services/repository', () => ({ repository: mockDb }));

import handler from '@/pages/api/stremio-tb/deletelink';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('API /api/stremio-tb/deletelink', () => {
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

	it('returns 400 when apiKey is missing', async () => {
		const req = createMockRequest({ method: 'DELETE', body: { imdbId: 'tt123', hash: 'abc' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(400);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'Missing or invalid "apiKey" in request body',
		});
	});

	it('returns 400 when imdbId is missing', async () => {
		const req = createMockRequest({
			method: 'DELETE',
			body: { apiKey: 'key', hash: 'abc' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(400);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'Missing or invalid "imdbId" or "hash" in request body',
		});
	});

	it('returns 400 when hash is missing', async () => {
		const req = createMockRequest({
			method: 'DELETE',
			body: { apiKey: 'key', imdbId: 'tt123' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(400);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'Missing or invalid "imdbId" or "hash" in request body',
		});
	});

	it('returns 401 when API key is invalid', async () => {
		mockHelpers.validateTorBoxApiKey.mockResolvedValue({ valid: false });
		const req = createMockRequest({
			method: 'DELETE',
			body: { apiKey: 'bad-key', imdbId: 'tt123', hash: 'abc' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(401);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'Invalid TorBox API key',
		});
	});

	it('deletes link and returns success', async () => {
		mockHelpers.validateTorBoxApiKey.mockResolvedValue({ valid: true });
		mockHelpers.generateTorBoxUserId.mockResolvedValue('tb-user-456');
		mockDb.deleteTorBoxCastedLink.mockResolvedValue(undefined);
		const req = createMockRequest({
			method: 'DELETE',
			body: { apiKey: 'valid-key', imdbId: 'tt123', hash: 'abc' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockDb.deleteTorBoxCastedLink).toHaveBeenCalledWith('tt123', 'tb-user-456', 'abc');
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({
			status: 'success',
			message: 'Link deleted successfully',
		});
	});

	it('returns 500 on error', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockHelpers.validateTorBoxApiKey.mockRejectedValue(new Error('Connection lost'));
		const req = createMockRequest({
			method: 'DELETE',
			body: { apiKey: 'valid-key', imdbId: 'tt123', hash: 'abc' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'Connection lost',
		});
	});
});
