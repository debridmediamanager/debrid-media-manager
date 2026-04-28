import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHelpers = vi.hoisted(() => ({
	validateMethod: vi.fn(),
	validateApiKey: vi.fn(),
	generateAllDebridUserId: vi.fn(),
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

	it('returns early when validateMethod fails', async () => {
		mockHelpers.validateMethod.mockReturnValue(false);
		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockHelpers.validateMethod).toHaveBeenCalledWith(req, res, ['GET']);
		expect(mockHelpers.validateApiKey).not.toHaveBeenCalled();
	});

	it('returns early when validateApiKey fails', async () => {
		mockHelpers.validateMethod.mockReturnValue(true);
		mockHelpers.validateApiKey.mockReturnValue(null);
		const req = createMockRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(mockHelpers.validateApiKey).toHaveBeenCalledWith(req, res);
		expect(mockHelpers.generateAllDebridUserId).not.toHaveBeenCalled();
	});

	it('returns user ID on success', async () => {
		mockHelpers.validateMethod.mockReturnValue(true);
		mockHelpers.validateApiKey.mockReturnValue('test-key');
		mockHelpers.generateAllDebridUserId.mockResolvedValue('user-123');
		const req = createMockRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(mockHelpers.generateAllDebridUserId).toHaveBeenCalledWith('test-key');
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ id: 'user-123' });
	});

	it('returns 500 on error with Error instance', async () => {
		mockHelpers.validateMethod.mockReturnValue(true);
		mockHelpers.validateApiKey.mockReturnValue('test-key');
		mockHelpers.generateAllDebridUserId.mockRejectedValue(new Error('API failure'));
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
		mockHelpers.generateAllDebridUserId.mockRejectedValue('string error');
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
