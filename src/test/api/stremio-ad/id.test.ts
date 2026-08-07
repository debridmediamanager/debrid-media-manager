import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHelpers = vi.hoisted(() => ({
	validateMethod: vi.fn(),
	validateApiKey: vi.fn(),
	resolveAllDebridUser: vi.fn(),
}));

vi.mock('@/utils/allDebridCastApiHelpers', () => mockHelpers);

import handler from '@/pages/api/stremio-ad/id';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('API /api/stremio-ad/id', () => {
	it('sets CORS header', async () => {
		mockHelpers.validateMethod.mockReturnValue(false);
		const req = createMockRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
	});

	it('marks the response uncacheable so no proxy retains it', async () => {
		mockHelpers.validateMethod.mockReturnValue(false);
		const req = createMockRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, private');
	});

	it('accepts POST only, keeping the api key out of the query string', async () => {
		mockHelpers.validateMethod.mockReturnValue(false);
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockHelpers.validateMethod).toHaveBeenCalledWith(req, res, ['POST']);
		expect(mockHelpers.validateApiKey).not.toHaveBeenCalled();
	});

	it('returns early when validateApiKey fails', async () => {
		mockHelpers.validateMethod.mockReturnValue(true);
		mockHelpers.validateApiKey.mockReturnValue(null);
		const req = createMockRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(mockHelpers.validateApiKey).toHaveBeenCalledWith(req, res);
		expect(mockHelpers.resolveAllDebridUser).not.toHaveBeenCalled();
	});

	it('returns user ID from a single AllDebrid call', async () => {
		mockHelpers.validateMethod.mockReturnValue(true);
		mockHelpers.validateApiKey.mockReturnValue('test-key');
		mockHelpers.resolveAllDebridUser.mockResolvedValue({ valid: true, userId: 'user-123' });
		const req = createMockRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(mockHelpers.resolveAllDebridUser).toHaveBeenCalledTimes(1);
		expect(mockHelpers.resolveAllDebridUser).toHaveBeenCalledWith('test-key');
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ id: 'user-123' });
	});

	it('returns 401 when the key is rejected', async () => {
		mockHelpers.validateMethod.mockReturnValue(true);
		mockHelpers.validateApiKey.mockReturnValue('test-key');
		mockHelpers.resolveAllDebridUser.mockResolvedValue({ valid: false });
		const req = createMockRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(401);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'Invalid AllDebrid API key',
		});
	});

	it('returns 500 on error with Error instance', async () => {
		mockHelpers.validateMethod.mockReturnValue(true);
		mockHelpers.validateApiKey.mockReturnValue('test-key');
		mockHelpers.resolveAllDebridUser.mockRejectedValue(new Error('API failure'));
		const req = createMockRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'API failure',
		});
	});

	it('returns 500 with Unknown error for non-Error throws', async () => {
		mockHelpers.validateMethod.mockReturnValue(true);
		mockHelpers.validateApiKey.mockReturnValue('test-key');
		mockHelpers.resolveAllDebridUser.mockRejectedValue('string error');
		const req = createMockRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'Unknown error',
		});
	});
});
