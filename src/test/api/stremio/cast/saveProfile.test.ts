import handler from '@/pages/api/stremio/cast/saveProfile';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { signSponsorToken } from '@/utils/sponsorToken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
		// The shape Prisma actually returns: the whole row, credentials included.
		mockSaveCastProfile.mockResolvedValue({
			userId: 'user-1',
			clientId: 'LEAK_CLIENT',
			clientSecret: 'LEAK_SECRET',
			refreshToken: 'LEAK_REFRESH',
			movieMaxSize: 10,
			episodeMaxSize: 3,
			otherStreamsLimit: 5,
			hideCastOption: false,
		});
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
		expect(res.json).toHaveBeenCalledWith({
			userId: 'user-1',
			movieMaxSize: 10,
			episodeMaxSize: 3,
			otherStreamsLimit: 5,
			hideCastOption: false,
		});
	});

	// The raw Prisma row carries the caller's long-lived Real-Debrid credentials,
	// and returning it echoed them straight back over the wire. Whitelisted now,
	// matching the TorBox and AllDebrid cast endpoints.
	it('never echoes the stored credentials back in the response', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' },
		});
		const res = createMockResponse();

		await handler(req, res);

		const body = JSON.stringify(
			(res.json as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]
		);
		for (const secret of ['LEAK_SECRET', 'LEAK_REFRESH', 'LEAK_CLIENT']) {
			expect(body).not.toContain(secret);
		}
		expect(body).not.toContain('clientSecret');
		expect(body).not.toContain('refreshToken');
	});

	// `console.error(err)` on an AxiosError expands the whole object, and
	// `config.data` is the OAuth POST body — so the bare form wrote clientId,
	// clientSecret and the refresh token into the container logs on every
	// refused refresh.
	it('does not log the credentials when the token fetch fails', async () => {
		const axiosLike = Object.assign(new Error('Request failed with status code 400'), {
			isAxiosError: true,
			config: {
				data: 'client_id=LEAK_CLIENT&client_secret=LEAK_SECRET&code=LEAK_REFRESH',
			},
		});
		mockGetToken.mockRejectedValue(axiosLike);
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const req = createMockRequest({
			method: 'POST',
			body: { clientId: 'LEAK_CLIENT', clientSecret: 'LEAK_SECRET' },
		});
		await handler(req, createMockResponse());

		const logged = spy.mock.calls.map((c) => JSON.stringify(c)).join(' ');
		expect(logged).not.toContain('LEAK_SECRET');
		expect(logged).not.toContain('LEAK_REFRESH');
		spy.mockRestore();
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

	describe('sponsor stream limit', () => {
		beforeEach(() => {
			process.env.DMM_SPONSOR_SECRET = 'test-sponsor-secret';
		});

		afterEach(() => {
			delete process.env.DMM_SPONSOR_SECRET;
		});

		const sponsorToken = () =>
			signSponsorToken({
				shortId: 'ZP1M',
				githubUsername: 'someone',
				sources: ['github'],
				keyVersion: 1,
				exp: Date.now() + 3_600_000,
			});

		const save = (otherStreamsLimit: number, headers: Record<string, string> = {}) =>
			createMockRequest({
				method: 'POST',
				headers,
				body: { clientId: 'id', clientSecret: 'secret', otherStreamsLimit },
			});

		it('lets a sponsor set 10', async () => {
			const res = createMockResponse();
			await handler(save(10, { 'x-dmm-sponsor': sponsorToken() }), res);

			expect(res.status).toHaveBeenCalledWith(200);
			expect(mockSaveCastProfile).toHaveBeenCalledWith(
				'user-1',
				'id',
				'secret',
				null,
				undefined,
				undefined,
				10,
				undefined
			);
		});

		it('still refuses 11 from a sponsor', async () => {
			const res = createMockResponse();
			await handler(save(11, { 'x-dmm-sponsor': sponsorToken() }), res);

			expect(res.status).toHaveBeenCalledWith(400);
			expect(res.json).toHaveBeenCalledWith({
				error: 'otherStreamsLimit must be an integer between 0 and 10',
			});
			expect(mockSaveCastProfile).not.toHaveBeenCalled();
		});

		// A forged token must not buy the raised ceiling, or the gate is decorative.
		it('refuses 10 when the token is forged', async () => {
			const res = createMockResponse();
			await handler(save(10, { 'x-dmm-sponsor': 'forged.signature' }), res);

			expect(res.status).toHaveBeenCalledWith(400);
			expect(mockSaveCastProfile).not.toHaveBeenCalled();
		});

		it('still lets a sponsor set a value inside the standard range', async () => {
			const res = createMockResponse();
			await handler(save(3, { 'x-dmm-sponsor': sponsorToken() }), res);
			expect(res.status).toHaveBeenCalledWith(200);
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
