import handler from '@/pages/api/stremio/cast/updateSizeLimits';
import * as rdModule from '@/services/realDebrid';
import * as repoModule from '@/services/repository';
import * as castHelpersModule from '@/utils/castApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/realDebrid');
vi.mock('@/services/repository');
vi.mock('@/utils/castApiHelpers');

describe('/api/stremio/cast/updateSizeLimits', () => {
	let req: Partial<NextApiRequest>;
	let res: Partial<NextApiResponse>;

	beforeEach(() => {
		req = {
			method: 'POST',
			body: {},
		};
		res = {
			status: vi.fn().mockReturnThis(),
			json: vi.fn().mockReturnThis(),
			setHeader: vi.fn().mockReturnThis(),
		};
	});

	it('returns 405 for non-POST requests', async () => {
		req.method = 'GET';
		await handler(req as NextApiRequest, res as NextApiResponse);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
	});

	it('returns 400 if clientId or clientSecret is missing', async () => {
		req.body = { movieMaxSize: 15 };
		await handler(req as NextApiRequest, res as NextApiResponse);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Missing required fields' });
	});

	it('returns 400 if no settings are provided', async () => {
		req.body = { clientId: 'client', clientSecret: 'secret' };
		await handler(req as NextApiRequest, res as NextApiResponse);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'At least one setting must be provided',
		});
	});

	const tokenResponse = {
		access_token: 'token',
		refresh_token: 'refresh',
		expires_in: 3600,
		token_type: 'Bearer',
	};

	it('updates movie size limit successfully', async () => {
		req.body = {
			clientId: 'client',
			clientSecret: 'secret',
			refreshToken: 'refresh',
			movieMaxSize: 15,
		};

		vi.spyOn(rdModule, 'getToken').mockResolvedValue(tokenResponse);
		vi.spyOn(castHelpersModule, 'generateUserId').mockResolvedValue('user123');
		vi.spyOn(repoModule.repository, 'saveCastProfile').mockResolvedValue({
			userId: 'user123',
			clientId: 'client',
			clientSecret: 'secret',
			refreshToken: 'refresh',
			movieMaxSize: 15,
			episodeMaxSize: 0,
			otherStreamsLimit: 5,
			hideCastOption: false,
			updatedAt: new Date(),
		});

		await handler(req as NextApiRequest, res as NextApiResponse);

		expect(rdModule.getToken).toHaveBeenCalledWith('client', 'secret', 'refresh', true);
		expect(repoModule.repository.saveCastProfile).toHaveBeenCalledWith(
			'user123',
			'client',
			'secret',
			'refresh',
			15,
			undefined,
			undefined,
			undefined
		);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('updates episode size limit successfully', async () => {
		req.body = {
			clientId: 'client',
			clientSecret: 'secret',
			refreshToken: 'refresh',
			episodeMaxSize: 3,
		};

		vi.spyOn(rdModule, 'getToken').mockResolvedValue(tokenResponse);
		vi.spyOn(castHelpersModule, 'generateUserId').mockResolvedValue('user123');
		vi.spyOn(repoModule.repository, 'saveCastProfile').mockResolvedValue({
			userId: 'user123',
			clientId: 'client',
			clientSecret: 'secret',
			refreshToken: 'refresh',
			movieMaxSize: 0,
			episodeMaxSize: 3,
			otherStreamsLimit: 5,
			hideCastOption: false,
			updatedAt: new Date(),
		});

		await handler(req as NextApiRequest, res as NextApiResponse);

		expect(repoModule.repository.saveCastProfile).toHaveBeenCalledWith(
			'user123',
			'client',
			'secret',
			'refresh',
			undefined,
			3,
			undefined,
			undefined
		);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('updates both size limits successfully', async () => {
		req.body = {
			clientId: 'client',
			clientSecret: 'secret',
			refreshToken: 'refresh',
			movieMaxSize: 15,
			episodeMaxSize: 3,
		};

		vi.spyOn(rdModule, 'getToken').mockResolvedValue(tokenResponse);
		vi.spyOn(castHelpersModule, 'generateUserId').mockResolvedValue('user123');
		vi.spyOn(repoModule.repository, 'saveCastProfile').mockResolvedValue({
			userId: 'user123',
			clientId: 'client',
			clientSecret: 'secret',
			refreshToken: 'refresh',
			movieMaxSize: 15,
			episodeMaxSize: 3,
			otherStreamsLimit: 5,
			hideCastOption: false,
			updatedAt: new Date(),
		});

		await handler(req as NextApiRequest, res as NextApiResponse);

		expect(repoModule.repository.saveCastProfile).toHaveBeenCalledWith(
			'user123',
			'client',
			'secret',
			'refresh',
			15,
			3,
			undefined,
			undefined
		);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('updates other streams limit successfully', async () => {
		req.body = {
			clientId: 'client',
			clientSecret: 'secret',
			refreshToken: 'refresh',
			otherStreamsLimit: 3,
		};

		vi.spyOn(rdModule, 'getToken').mockResolvedValue(tokenResponse);
		vi.spyOn(castHelpersModule, 'generateUserId').mockResolvedValue('user123');
		vi.spyOn(repoModule.repository, 'saveCastProfile').mockResolvedValue({
			userId: 'user123',
			clientId: 'client',
			clientSecret: 'secret',
			refreshToken: 'refresh',
			movieMaxSize: 0,
			episodeMaxSize: 0,
			otherStreamsLimit: 3,
			hideCastOption: false,
			updatedAt: new Date(),
		});

		await handler(req as NextApiRequest, res as NextApiResponse);

		expect(repoModule.repository.saveCastProfile).toHaveBeenCalledWith(
			'user123',
			'client',
			'secret',
			'refresh',
			undefined,
			undefined,
			3,
			undefined
		);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('rejects otherStreamsLimit greater than 5', async () => {
		req.body = {
			clientId: 'client',
			clientSecret: 'secret',
			refreshToken: 'refresh',
			otherStreamsLimit: 10,
		};

		await handler(req as NextApiRequest, res as NextApiResponse);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'otherStreamsLimit must be an integer between 0 and 5',
		});
	});

	it('rejects negative otherStreamsLimit', async () => {
		req.body = {
			clientId: 'client',
			clientSecret: 'secret',
			refreshToken: 'refresh',
			otherStreamsLimit: -1,
		};

		await handler(req as NextApiRequest, res as NextApiResponse);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'otherStreamsLimit must be an integer between 0 and 5',
		});
	});

	it('rejects non-integer otherStreamsLimit', async () => {
		req.body = {
			clientId: 'client',
			clientSecret: 'secret',
			refreshToken: 'refresh',
			otherStreamsLimit: 2.5,
		};

		await handler(req as NextApiRequest, res as NextApiResponse);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: 'otherStreamsLimit must be an integer between 0 and 5',
		});
	});

	it('updates all settings successfully', async () => {
		req.body = {
			clientId: 'client',
			clientSecret: 'secret',
			refreshToken: 'refresh',
			movieMaxSize: 15,
			episodeMaxSize: 3,
			otherStreamsLimit: 4,
		};

		vi.spyOn(rdModule, 'getToken').mockResolvedValue(tokenResponse);
		vi.spyOn(castHelpersModule, 'generateUserId').mockResolvedValue('user123');
		vi.spyOn(repoModule.repository, 'saveCastProfile').mockResolvedValue({
			userId: 'user123',
			clientId: 'client',
			clientSecret: 'secret',
			refreshToken: 'refresh',
			movieMaxSize: 15,
			episodeMaxSize: 3,
			otherStreamsLimit: 4,
			hideCastOption: false,
			updatedAt: new Date(),
		});

		await handler(req as NextApiRequest, res as NextApiResponse);

		expect(repoModule.repository.saveCastProfile).toHaveBeenCalledWith(
			'user123',
			'client',
			'secret',
			'refresh',
			15,
			3,
			4,
			undefined
		);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('returns 500 when token retrieval fails', async () => {
		req.body = {
			clientId: 'client',
			clientSecret: 'secret',
			movieMaxSize: 15,
		};

		vi.spyOn(rdModule, 'getToken').mockRejectedValue(new Error('Token error'));

		await handler(req as NextApiRequest, res as NextApiResponse);

		expect(res.status).toHaveBeenCalledWith(500);
	});

	// The raw Prisma row carries the caller's long-lived Real-Debrid credentials.
	// Returning it echoed them straight back; the response is whitelisted now.
	it('never echoes the stored credentials back in the response', async () => {
		req.body = { clientId: 'LEAK_CLIENT', clientSecret: 'LEAK_SECRET', movieMaxSize: 15 };

		vi.spyOn(rdModule, 'getToken').mockResolvedValue(tokenResponse);
		vi.spyOn(castHelpersModule, 'generateUserId').mockResolvedValue('user123');
		vi.spyOn(repoModule.repository, 'saveCastProfile').mockResolvedValue({
			userId: 'user123',
			clientId: 'LEAK_CLIENT',
			clientSecret: 'LEAK_SECRET',
			refreshToken: 'LEAK_REFRESH',
			movieMaxSize: 15,
			episodeMaxSize: 0,
			otherStreamsLimit: 5,
			hideCastOption: false,
			updatedAt: new Date(),
		});

		await handler(req as NextApiRequest, res as NextApiResponse);

		const body = JSON.stringify((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]);
		expect(body).not.toContain('LEAK_SECRET');
		expect(body).not.toContain('LEAK_REFRESH');
	});

	// Expanding an AxiosError prints `config.data` — the OAuth POST body, which
	// carries clientSecret and the refresh token. That went to the container logs.
	it('does not log the credentials when the token fetch fails', async () => {
		req.body = { clientId: 'LEAK_CLIENT', clientSecret: 'LEAK_SECRET' };

		const axiosLike = Object.assign(new Error('Request failed with status code 400'), {
			isAxiosError: true,
			config: { data: 'client_secret=LEAK_SECRET&code=LEAK_REFRESH' },
		});
		vi.spyOn(rdModule, 'getToken').mockRejectedValue(axiosLike);
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await handler(req as NextApiRequest, res as NextApiResponse);

		const logged = spy.mock.calls.map((c) => JSON.stringify(c)).join(' ');
		expect(logged).not.toContain('LEAK_SECRET');
		expect(logged).not.toContain('LEAK_REFRESH');
		spy.mockRestore();
	});
});
