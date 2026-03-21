import handler from '@/pages/api/stremio-ad/cast/saveProfile';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockValidateApiKey, mockGenerateUserId, mockSaveCastProfile } = vi.hoisted(() => ({
	mockValidateApiKey: vi.fn(),
	mockGenerateUserId: vi.fn(),
	mockSaveCastProfile: vi.fn(),
}));

vi.mock('@/utils/allDebridCastApiHelpers', () => ({
	validateAllDebridApiKey: mockValidateApiKey,
	generateAllDebridUserId: mockGenerateUserId,
}));

vi.mock('@/services/repository', () => ({
	repository: {
		saveAllDebridCastProfile: mockSaveCastProfile,
	},
}));

describe('/api/stremio-ad/cast/saveProfile', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValidateApiKey.mockResolvedValue({ valid: true });
		mockGenerateUserId.mockResolvedValue('ad-user-1');
		mockSaveCastProfile.mockResolvedValue({
			userId: 'ad-user-1',
			movieMaxSize: 0,
			episodeMaxSize: 0,
			otherStreamsLimit: 5,
			hideCastOption: false,
		});
	});

	it('rejects non-POST methods', async () => {
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
	});

	it('validates apiKey is present', async () => {
		const req = createMockRequest({ method: 'POST', body: {} });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('rejects invalid API key', async () => {
		mockValidateApiKey.mockResolvedValue({ valid: false });
		const req = createMockRequest({ method: 'POST', body: { apiKey: 'bad' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(401);
	});

	it('saves profile without settings', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { apiKey: 'ad-key' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockSaveCastProfile).toHaveBeenCalledWith(
			'ad-user-1',
			'ad-key',
			undefined,
			undefined,
			undefined,
			undefined
		);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('saves profile with all settings', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: {
				apiKey: 'ad-key',
				movieMaxSize: 30,
				episodeMaxSize: 5,
				otherStreamsLimit: 4,
				hideCastOption: true,
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockSaveCastProfile).toHaveBeenCalledWith('ad-user-1', 'ad-key', 30, 5, 4, true);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('returns hideCastOption in response', async () => {
		mockSaveCastProfile.mockResolvedValue({
			userId: 'ad-user-1',
			movieMaxSize: 30,
			episodeMaxSize: 5,
			otherStreamsLimit: 4,
			hideCastOption: true,
		});

		const req = createMockRequest({
			method: 'POST',
			body: { apiKey: 'ad-key', hideCastOption: true },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				profile: expect.objectContaining({ hideCastOption: true }),
			})
		);
	});

	it('validates otherStreamsLimit range', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { apiKey: 'ad-key', otherStreamsLimit: 10 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockSaveCastProfile).not.toHaveBeenCalled();
	});

	it('rejects negative otherStreamsLimit', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { apiKey: 'ad-key', otherStreamsLimit: -1 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('rejects non-integer otherStreamsLimit', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { apiKey: 'ad-key', otherStreamsLimit: 2.5 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('accepts otherStreamsLimit of 0', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { apiKey: 'ad-key', otherStreamsLimit: 0 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockSaveCastProfile).toHaveBeenCalledWith(
			'ad-user-1',
			'ad-key',
			undefined,
			undefined,
			0,
			undefined
		);
	});

	it('accepts otherStreamsLimit of 5', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { apiKey: 'ad-key', otherStreamsLimit: 5 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockSaveCastProfile).toHaveBeenCalledWith(
			'ad-user-1',
			'ad-key',
			undefined,
			undefined,
			5,
			undefined
		);
	});
});
