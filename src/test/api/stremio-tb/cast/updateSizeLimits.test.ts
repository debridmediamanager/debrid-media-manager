import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHelpers = vi.hoisted(() => ({
	validateTorBoxApiKey: vi.fn(),
	generateTorBoxUserId: vi.fn(),
}));

const mockDb = vi.hoisted(() => ({
	saveTorBoxCastProfile: vi.fn(),
}));

vi.mock('@/utils/torboxCastApiHelpers', () => mockHelpers);
vi.mock('@/services/repository', () => ({ repository: mockDb }));

import handler from '@/pages/api/stremio-tb/cast/updateSizeLimits';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

const validProfile = {
	userId: 'tb-user-456',
	movieMaxSize: 5000,
	episodeMaxSize: 2000,
	otherStreamsLimit: 3,
	hideCastOption: false,
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('API /api/stremio-tb/cast/updateSizeLimits', () => {
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

	it('returns 400 when otherStreamsLimit is negative', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { apiKey: 'key', otherStreamsLimit: -1 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(400);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'otherStreamsLimit must be an integer between 0 and 5',
		});
	});

	it('returns 400 when otherStreamsLimit exceeds 5', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { apiKey: 'key', otherStreamsLimit: 6 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(400);
	});

	it('returns 400 when otherStreamsLimit is not an integer', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { apiKey: 'key', otherStreamsLimit: 2.5 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(400);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'otherStreamsLimit must be an integer between 0 and 5',
		});
	});

	it('returns 401 when API key is invalid', async () => {
		mockHelpers.validateTorBoxApiKey.mockResolvedValue({ valid: false });
		const req = createMockRequest({
			method: 'POST',
			body: { apiKey: 'bad-key' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(401);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'Invalid TorBox API key',
		});
	});

	it('saves profile and returns success', async () => {
		mockHelpers.validateTorBoxApiKey.mockResolvedValue({ valid: true });
		mockHelpers.generateTorBoxUserId.mockResolvedValue('tb-user-456');
		mockDb.saveTorBoxCastProfile.mockResolvedValue(validProfile);
		const req = createMockRequest({
			method: 'POST',
			body: {
				apiKey: 'valid-key',
				movieMaxSize: 5000,
				episodeMaxSize: 2000,
				otherStreamsLimit: 3,
				hideCastOption: false,
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockDb.saveTorBoxCastProfile).toHaveBeenCalledWith(
			'tb-user-456',
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

	it('accepts otherStreamsLimit of 0', async () => {
		mockHelpers.validateTorBoxApiKey.mockResolvedValue({ valid: true });
		mockHelpers.generateTorBoxUserId.mockResolvedValue('tb-user-456');
		mockDb.saveTorBoxCastProfile.mockResolvedValue({ ...validProfile, otherStreamsLimit: 0 });
		const req = createMockRequest({
			method: 'POST',
			body: { apiKey: 'valid-key', otherStreamsLimit: 0 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
	});

	it('returns 500 on error', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockHelpers.validateTorBoxApiKey.mockRejectedValue(new Error('Service unavailable'));
		const req = createMockRequest({
			method: 'POST',
			body: { apiKey: 'valid-key' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({
			status: 'error',
			errorMessage: 'Service unavailable',
		});
	});
});
