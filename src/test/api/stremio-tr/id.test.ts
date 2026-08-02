import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHelpers = vi.hoisted(() => ({
	validateMethod: vi.fn(),
	validateTorrinCreds: vi.fn(),
	generateTorrinUserId: vi.fn(),
}));

vi.mock('@/utils/torrinCastApiHelpers', () => mockHelpers);

import handler from '@/pages/api/stremio-tr/id';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('API /api/stremio-tr/id', () => {
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
		expect(mockHelpers.validateTorrinCreds).not.toHaveBeenCalled();
	});

	it('returns early when validateTorrinCreds fails', async () => {
		mockHelpers.validateMethod.mockReturnValue(true);
		mockHelpers.validateTorrinCreds.mockReturnValue(null);
		const req = createMockRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(mockHelpers.validateTorrinCreds).toHaveBeenCalledWith(req, res);
		expect(mockHelpers.generateTorrinUserId).not.toHaveBeenCalled();
	});

	it('returns user ID on success', async () => {
		mockHelpers.validateMethod.mockReturnValue(true);
		mockHelpers.validateTorrinCreds.mockReturnValue({
			baseUrl: 'https://tr.test',
			apiKey: 'test-key',
		});
		mockHelpers.generateTorrinUserId.mockResolvedValue('tr-user-456');
		const req = createMockRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(mockHelpers.generateTorrinUserId).toHaveBeenCalledWith(
			'https://tr.test',
			'test-key'
		);
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ id: 'tr-user-456' });
	});

	it('returns 500 on error with Error instance', async () => {
		mockHelpers.validateMethod.mockReturnValue(true);
		mockHelpers.validateTorrinCreds.mockReturnValue({
			baseUrl: 'https://tr.test',
			apiKey: 'test-key',
		});
		mockHelpers.generateTorrinUserId.mockRejectedValue(new Error('API failure'));
		const req = createMockRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'Failed to generate user ID',
		});
	});

	it('returns 500 with Unknown error for non-Error throws', async () => {
		mockHelpers.validateMethod.mockReturnValue(true);
		mockHelpers.validateTorrinCreds.mockReturnValue({
			baseUrl: 'https://tr.test',
			apiKey: 'test-key',
		});
		mockHelpers.generateTorrinUserId.mockRejectedValue('string error');
		const req = createMockRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'Failed to generate user ID',
		});
	});
});
