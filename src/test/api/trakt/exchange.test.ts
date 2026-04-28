import handler from '@/pages/api/trakt/exchange';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('/api/trakt/exchange', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.TRAKT_CLIENT_ID = 'test-client-id';
		process.env.TRAKT_CLIENT_SECRET = 'test-client-secret';
	});

	it('returns 400 when code is missing', async () => {
		const req = createMockRequest({ query: {} });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			errorMessage: "Missing 'code' query parameter",
		});
	});

	it('makes correct POST to Trakt API', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			text: () => Promise.resolve(JSON.stringify({ access_token: 'abc123' })),
		});

		const req = createMockRequest({
			query: { code: 'auth-code', redirect: 'http://localhost:3000/trakt/callback' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockFetch).toHaveBeenCalledWith('https://api.trakt.tv/oauth/token', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'user-agent': 'debridmediamanager/1.0',
			},
			body: JSON.stringify({
				code: 'auth-code',
				client_id: 'test-client-id',
				client_secret: 'test-client-secret',
				redirect_uri: 'http://localhost:3000/trakt/callback',
				grant_type: 'authorization_code',
			}),
		});
	});

	it('returns token response on success', async () => {
		const tokenData = {
			access_token: 'abc123',
			token_type: 'Bearer',
			expires_in: 7776000,
			refresh_token: 'def456',
		};
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			text: () => Promise.resolve(JSON.stringify(tokenData)),
		});

		const req = createMockRequest({ query: { code: 'auth-code' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(tokenData);
	});

	it('returns 502 when Trakt returns non-JSON', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockFetch.mockResolvedValue({
			ok: false,
			status: 503,
			text: () => Promise.resolve('<html>Service Unavailable</html>'),
		});

		const req = createMockRequest({ query: { code: 'auth-code' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(502);
		expect(res.json).toHaveBeenCalledWith({
			error: 'token_exchange_failed',
			error_description: 'Trakt returned non-JSON response',
		});
	});

	it('returns 500 when fetch throws', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockFetch.mockRejectedValue(new Error('Network failure'));

		const req = createMockRequest({ query: { code: 'auth-code' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			error: 'token_exchange_failed',
			error_description: 'Error: Network failure',
		});
	});

	it('passes redirect query param as redirect_uri', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			text: () => Promise.resolve(JSON.stringify({ access_token: 'token' })),
		});

		const req = createMockRequest({
			query: { code: 'auth-code', redirect: 'https://debridmediamanager.com/trakt/callback' },
		});
		const res = createMockResponse();

		await handler(req, res);

		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		expect(body.redirect_uri).toBe('https://debridmediamanager.com/trakt/callback');
	});

	it('uses empty string for redirect_uri when redirect not provided', async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			text: () => Promise.resolve(JSON.stringify({ access_token: 'token' })),
		});

		const req = createMockRequest({ query: { code: 'auth-code' } });
		const res = createMockResponse();

		await handler(req, res);

		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		expect(body.redirect_uri).toBe('');
	});

	it('forwards non-200 status from Trakt when response is valid JSON', async () => {
		const errorData = { error: 'invalid_grant' };
		mockFetch.mockResolvedValue({
			ok: false,
			status: 401,
			text: () => Promise.resolve(JSON.stringify(errorData)),
		});

		const req = createMockRequest({ query: { code: 'bad-code' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.json).toHaveBeenCalledWith(errorData);
	});
});
