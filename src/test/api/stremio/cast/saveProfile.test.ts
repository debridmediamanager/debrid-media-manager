import handler from '@/pages/api/stremio/cast/saveProfile';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetToken, mockGenerateUserId, mockSaveCastProfile } = vi.hoisted(() => ({
	mockGetToken: vi.fn(),
	mockGenerateUserId: vi.fn(),
	mockSaveCastProfile: vi.fn(),
}));

vi.mock('@/services/realDebrid', () => ({
	getToken: mockGetToken,
}));

vi.mock('@/utils/castApiHelpers', () => ({
	generateUserId: mockGenerateUserId,
}));

vi.mock('@/services/repository', () => ({
	repository: {
		saveCastProfile: mockSaveCastProfile,
	},
}));

describe('/api/stremio/cast/saveProfile', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetToken.mockResolvedValue({ access_token: 'rd-token' });
		mockGenerateUserId.mockResolvedValue('user-1');
		mockSaveCastProfile.mockResolvedValue({ ok: true });
	});

	it('rejects non-POST methods', async () => {
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
	});

	it('validates required fields', async () => {
		const req = createMockRequest({ method: 'POST', body: { clientId: 'id' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Missing required fields' });
	});

	it('saves the profile when RD token can be generated', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGetToken).toHaveBeenCalledWith('id', 'secret', 'refresh', true);
		expect(mockGenerateUserId).toHaveBeenCalledWith('rd-token');
		expect(mockSaveCastProfile).toHaveBeenCalledWith(
			'user-1',
			'id',
			'secret',
			'refresh',
			undefined,
			undefined,
			undefined,
			undefined
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ ok: true });
	});

	it('saves the profile with settings when provided', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: {
				clientId: 'id',
				clientSecret: 'secret',
				refreshToken: 'refresh',
				movieMaxSize: 15,
				episodeMaxSize: 3,
				otherStreamsLimit: 2,
				hideCastOption: true,
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockSaveCastProfile).toHaveBeenCalledWith(
			'user-1',
			'id',
			'secret',
			'refresh',
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
			body: { clientId: 'id', clientSecret: 'secret', otherStreamsLimit: 10 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'otherStreamsLimit must be an integer between 0 and 5',
		});
	});

	it('returns 500 when Real-Debrid token fetch fails', async () => {
		mockGetToken.mockRejectedValue(new Error('oauth'));
		const req = createMockRequest({
			method: 'POST',
			body: { clientId: 'id', clientSecret: 'secret' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			error: expect.stringContaining('Failed to get Real-Debrid token'),
		});
	});

	it('catches unexpected errors while saving', async () => {
		mockSaveCastProfile.mockRejectedValue(new Error('db'));
		const req = createMockRequest({
			method: 'POST',
			body: { clientId: 'id', clientSecret: 'secret' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			error: expect.stringContaining('Internal Server Error'),
		});
	});
});
