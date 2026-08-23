import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getPremiumizeClientId,
	handlePremiumizeOAuthRequest,
	isOAuthAction,
} from './premiumizeOAuthProxy';

const jsonResponse = (body: unknown, status = 200) =>
	({
		status,
		headers: { get: (n: string) => (n === 'content-type' ? 'application/json' : null) },
		json: async () => body,
	}) as unknown as Response;

const fetchMock = vi.fn();

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const post = (over: Record<string, unknown> = {}) => ({
	method: 'POST',
	action: 'device',
	body: {},
	...over,
});

const sentParams = () => Object.fromEntries(new URLSearchParams(fetchMock.mock.calls[0][1].body));

describe('getPremiumizeClientId', () => {
	it('defaults to the registered debridmediamanager client', () => {
		expect(getPremiumizeClientId({} as NodeJS.ProcessEnv)).toBe('713833636');
	});

	it('lets a self-hosted instance point at its own registration', () => {
		expect(getPremiumizeClientId({ PREMIUMIZE_CLIENT_ID: '999' } as any)).toBe('999');
	});
});

describe('isOAuthAction', () => {
	it('accepts only the two real actions', () => {
		expect(isOAuthAction('device')).toBe(true);
		expect(isOAuthAction('token')).toBe(true);
		expect(isOAuthAction('authorize')).toBe(false);
		expect(isOAuthAction(undefined)).toBe(false);
	});
});

describe('handlePremiumizeOAuthRequest', () => {
	it('refuses anything but POST', async () => {
		const r = await handlePremiumizeOAuthRequest(post({ method: 'GET' }));
		expect(r.httpStatus).toBe(405);
		expect(r.allowHeader).toBe('POST');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('refuses an unknown action', async () => {
		const r = await handlePremiumizeOAuthRequest(post({ action: 'revoke' }));
		expect(r.httpStatus).toBe(404);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('requests a device code with the server-owned client id', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ user_code: 'uwu3-67m4', interval: 5 }));

		await handlePremiumizeOAuthRequest(post());

		expect(fetchMock.mock.calls[0][0]).toBe('https://www.premiumize.me/token');
		expect(sentParams()).toEqual({ response_type: 'device_code', client_id: '713833636' });
	});

	it('never takes the client id from the caller', async () => {
		// Otherwise a caller could mint device codes against someone else's
		// registered application through DMM.
		fetchMock.mockResolvedValue(jsonResponse({ user_code: 'x' }));

		await handlePremiumizeOAuthRequest(post({ body: { client_id: 'attacker-owned' } }));

		expect(sentParams().client_id).toBe('713833636');
	});

	it('sends no client_secret - the device flow does not use one', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ user_code: 'x' }));

		await handlePremiumizeOAuthRequest(post());

		expect(sentParams()).not.toHaveProperty('client_secret');
	});

	it('exchanges a device code for a token', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ access_token: 'tok', token_type: 'bearer', expires_in: 315360000 })
		);

		const r = await handlePremiumizeOAuthRequest(
			post({ action: 'token', body: { device_code: 'dc123' } })
		);

		expect(sentParams()).toEqual({
			grant_type: 'device_code',
			code: 'dc123',
			client_id: '713833636',
		});
		expect(r.body.access_token).toBe('tok');
	});

	it('rejects a token exchange with no device code before calling upstream', async () => {
		const r = await handlePremiumizeOAuthRequest(post({ action: 'token', body: {} }));
		expect(r.httpStatus).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('passes the OAuth 400 through so the poll loop can read the error string', async () => {
		// authorization_pending and a hard failure both arrive as HTTP 400; only
		// the `error` string separates them, so the status must not be flattened.
		fetchMock.mockResolvedValue(
			jsonResponse({ error: 'authorization_pending', error_description: 'not yet' }, 400)
		);

		const r = await handlePremiumizeOAuthRequest(
			post({ action: 'token', body: { device_code: 'dc' } })
		);

		expect(r.httpStatus).toBe(400);
		expect(r.body.error).toBe('authorization_pending');
	});

	it('reports a non-JSON upstream body rather than throwing on the parse', async () => {
		fetchMock.mockResolvedValue({
			status: 503,
			headers: { get: () => 'text/html' },
			json: async () => {
				throw new SyntaxError('nope');
			},
		} as unknown as Response);

		const r = await handlePremiumizeOAuthRequest(post());
		expect(r.httpStatus).toBe(502);
		expect(r.body.error).toBe('non_json_response');
	});

	it('reports a transport failure as an OAuth error envelope', async () => {
		fetchMock.mockRejectedValue(new Error('socket hang up'));

		const r = await handlePremiumizeOAuthRequest(post());
		expect(r.httpStatus).toBe(502);
		expect(r.body).toMatchObject({
			error: 'temporarily_unavailable',
			error_description: 'socket hang up',
		});
	});
});
