import handler from '@/pages/api/stremio-tr/cast/saveProfile';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockValidateApiKey, mockGenerateUserId, mockSaveCastProfile } = vi.hoisted(() => ({
	mockValidateApiKey: vi.fn(),
	mockGenerateUserId: vi.fn(),
	mockSaveCastProfile: vi.fn(),
}));

vi.mock('@/utils/torrinCastApiHelpers', () => ({
	validateTorrinApiKey: mockValidateApiKey,
	generateTorrinUserId: mockGenerateUserId,
}));

vi.mock('@/services/repository', () => ({
	repository: {
		saveTorrinCastProfile: mockSaveCastProfile,
	},
}));

const creds = { baseUrl: 'https://tr.test', apiKey: 'tr-key' };

describe('/api/stremio-tr/cast/saveProfile', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValidateApiKey.mockResolvedValue({ valid: true });
		mockGenerateUserId.mockResolvedValue('tr-user-1');
		mockSaveCastProfile.mockResolvedValue({
			userId: 'tr-user-1',
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

	it('validates creds are present', async () => {
		const req = createMockRequest({ method: 'POST', body: {} });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('rejects invalid credentials', async () => {
		mockValidateApiKey.mockResolvedValue({ valid: false });
		const req = createMockRequest({ method: 'POST', body: creds });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(401);
	});

	it('saves profile without settings', async () => {
		const req = createMockRequest({ method: 'POST', body: creds });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockSaveCastProfile).toHaveBeenCalledWith(
			'tr-user-1',
			'https://tr.test',
			'tr-key',
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
				...creds,
				movieMaxSize: 15,
				episodeMaxSize: 3,
				otherStreamsLimit: 2,
				hideCastOption: true,
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockSaveCastProfile).toHaveBeenCalledWith(
			'tr-user-1',
			'https://tr.test',
			'tr-key',
			15,
			3,
			2,
			true
		);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('validates otherStreamsLimit range', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { ...creds, otherStreamsLimit: 10 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockSaveCastProfile).not.toHaveBeenCalled();
	});

	it('rejects non-integer otherStreamsLimit', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { ...creds, otherStreamsLimit: 2.5 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('accepts otherStreamsLimit of 0', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { ...creds, otherStreamsLimit: 0 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockSaveCastProfile).toHaveBeenCalledWith(
			'tr-user-1',
			'https://tr.test',
			'tr-key',
			undefined,
			undefined,
			0,
			undefined
		);
	});
});
