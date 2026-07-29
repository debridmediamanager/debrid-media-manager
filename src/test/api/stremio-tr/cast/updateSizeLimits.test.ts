import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHelpers = vi.hoisted(() => ({
	validateTorrinApiKey: vi.fn(),
	generateTorrinUserId: vi.fn(),
}));

const mockDb = vi.hoisted(() => ({
	saveTorrinCastProfile: vi.fn(),
}));

vi.mock('@/utils/torrinCastApiHelpers', () => mockHelpers);
vi.mock('@/services/repository', () => ({ repository: mockDb }));

import handler from '@/pages/api/stremio-tr/cast/updateSizeLimits';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

const creds = { baseUrl: 'https://tr.test', apiKey: 'valid-key' };
const validProfile = {
	userId: 'tr-user-456',
	movieMaxSize: 5000,
	episodeMaxSize: 2000,
	otherStreamsLimit: 3,
	hideCastOption: false,
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('API /api/stremio-tr/cast/updateSizeLimits', () => {
	it('sets CORS header', async () => {
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
	});

	it('returns 405 for non-POST methods', async () => {
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.setHeader).toHaveBeenCalledWith('Allow', ['POST']);
		expect(res._getStatusCode()).toBe(405);
	});

	it('returns 400 when creds are missing', async () => {
		const req = createMockRequest({ method: 'POST', body: {} });
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(400);
	});

	it('returns 400 when otherStreamsLimit is out of range', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { ...creds, otherStreamsLimit: 6 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(400);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'otherStreamsLimit must be an integer between 0 and 5',
		});
	});

	it('returns 401 when credentials are invalid', async () => {
		mockHelpers.validateTorrinApiKey.mockResolvedValue({ valid: false });
		const req = createMockRequest({ method: 'POST', body: creds });
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(401);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'Invalid Torrin credentials',
		});
	});

	it('saves profile and returns success', async () => {
		mockHelpers.validateTorrinApiKey.mockResolvedValue({ valid: true });
		mockHelpers.generateTorrinUserId.mockResolvedValue('tr-user-456');
		mockDb.saveTorrinCastProfile.mockResolvedValue(validProfile);
		const req = createMockRequest({
			method: 'POST',
			body: {
				...creds,
				movieMaxSize: 5000,
				episodeMaxSize: 2000,
				otherStreamsLimit: 3,
				hideCastOption: false,
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockDb.saveTorrinCastProfile).toHaveBeenCalledWith(
			'tr-user-456',
			'https://tr.test',
			'valid-key',
			5000,
			2000,
			3,
			false
		);
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({
			status: 'success',
			profile: validProfile,
		});
	});

	it('returns 500 on error', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockHelpers.validateTorrinApiKey.mockRejectedValue(new Error('Service unavailable'));
		const req = createMockRequest({ method: 'POST', body: creds });
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'Failed to update size limits',
		});
	});
});
