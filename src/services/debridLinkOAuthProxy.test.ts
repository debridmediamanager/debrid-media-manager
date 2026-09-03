import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DEBRIDLINK_SCOPES,
	DEVICE_GRANT_TYPE,
	getDebridLinkClientId,
	handleDebridLinkOAuthRequest,
	isDebridLinkOAuthAction,
} from './debridLinkOAuthProxy';

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

const sentTo = () => fetchMock.mock.calls[0][0];
const sentParams = () => Object.fromEntries(new URLSearchParams(fetchMock.mock.calls[0][1].body));

describe('getDebridLinkClientId', () => {
	it("defaults to plex_debrid's public client", () => {
		expect(getDebridLinkClientId({} as NodeJS.ProcessEnv)).toBe('0KLCzpbPTCsWZtQ9Ad0aZA');
	});

	it('lets a self-hosted instance point at its own registration', () => {
		expect(getDebridLinkClientId({ DEBRIDLINK_CLIENT_ID: 'mine' } as any)).toBe('mine');
	});
});

describe('isDebridLinkOAuthAction', () => {
	it('accepts only the three real actions', () => {
		expect(isDebridLinkOAuthAction('device')).toBe(true);
		expect(isDebridLinkOAuthAction('token')).toBe(true);
		expect(isDebridLinkOAuthAction('refresh')).toBe(true);
		expect(isDebridLinkOAuthAction('revoke')).toBe(false);
		expect(isDebridLinkOAuthAction(undefined)).toBe(false);
	});
});

describe('handleDebridLinkOAuthRequest', () => {
	it('refuses anything but POST', async () => {
		const r = await handleDebridLinkOAuthRequest(post({ method: 'GET' }));

		expect(r.httpStatus).toBe(405);
		expect(r.allowHeader).toBe('POST');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('refuses an unknown action', async () => {
		const r = await handleDebridLinkOAuthRequest(post({ action: 'authorize' }));

		expect(r.httpStatus).toBe(404);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	// The device endpoint is NOT under /api/v2 - it sits beside the versioned
	// API rather than inside it.
	it('requests a device code from the unversioned oauth endpoint', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ device_code: 'dc', user_code: 'ABCD-1234' }));

		await handleDebridLinkOAuthRequest(post());

		expect(sentTo()).toBe('https://debrid-link.fr/api/oauth/device/code');
		expect(sentParams()).toEqual({
			client_id: '0KLCzpbPTCsWZtQ9Ad0aZA',
			scope: DEBRIDLINK_SCOPES,
		});
	});

	// The documented defaults drop the `delete` grants, and DMM deletes
	// torrents - a default-scoped token signs in fine and then cannot remove
	// anything.
	it('asks for the delete grant explicitly', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ device_code: 'dc' }));

		await handleDebridLinkOAuthRequest(post());

		expect(sentParams().scope).toContain('get.post.delete.seedbox');
		expect(sentParams().scope).toContain('get.account');
	});

	it('never takes the client id from the caller', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ device_code: 'dc' }));

		await handleDebridLinkOAuthRequest(post({ body: { client_id: 'attacker-owned' } }));

		expect(sentParams().client_id).toBe('0KLCzpbPTCsWZtQ9Ad0aZA');
	});

	it('sends no client_secret - the device flow does not use one', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ device_code: 'dc' }));

		await handleDebridLinkOAuthRequest(post());

		expect(sentParams()).not.toHaveProperty('client_secret');
	});

	// The vendor's grant type is the full URN, not the RFC 8628 spelling.
	it('exchanges a device code with the vendor grant type', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ access_token: 'tok', refresh_token: 'rtok', expires_in: 604800 })
		);

		const r = await handleDebridLinkOAuthRequest(
			post({ action: 'token', body: { device_code: 'dc123' } })
		);

		expect(sentTo()).toBe('https://debrid-link.fr/api/oauth/token');
		expect(sentParams()).toEqual({
			client_id: '0KLCzpbPTCsWZtQ9Ad0aZA',
			code: 'dc123',
			grant_type: DEVICE_GRANT_TYPE,
		});
		expect(DEVICE_GRANT_TYPE).toBe('http://oauth.net/grant_type/device/1.0');
		expect(r.body.access_token).toBe('tok');
	});

	it('rejects a token exchange with no device code before calling upstream', async () => {
		const r = await handleDebridLinkOAuthRequest(post({ action: 'token', body: {} }));

		expect(r.httpStatus).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('refreshes with grant_type=refresh_token', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ access_token: 'fresh' }));

		await handleDebridLinkOAuthRequest(
			post({ action: 'refresh', body: { refresh_token: 'r' } })
		);

		expect(sentTo()).toBe('https://debrid-link.fr/api/oauth/token');
		expect(sentParams()).toEqual({
			client_id: '0KLCzpbPTCsWZtQ9Ad0aZA',
			refresh_token: 'r',
			grant_type: 'refresh_token',
		});
	});

	it('rejects a refresh with no refresh token before calling upstream', async () => {
		const r = await handleDebridLinkOAuthRequest(post({ action: 'refresh', body: {} }));

		expect(r.httpStatus).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	// authorization_pending and a hard failure both arrive as 400; only the
	// `error` string separates them, so the status must not be flattened.
	it('passes the OAuth 400 through so the poll loop can read the error string', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ error: 'authorization_pending' }, 400));

		const r = await handleDebridLinkOAuthRequest(
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

		const r = await handleDebridLinkOAuthRequest(post());

		expect(r.httpStatus).toBe(502);
		expect(r.body.error).toBe('non_json_response');
	});

	it('reports a transport failure as an OAuth error envelope', async () => {
		fetchMock.mockRejectedValue(new Error('socket hang up'));

		const r = await handleDebridLinkOAuthRequest(post());

		expect(r.httpStatus).toBe(502);
		expect(r.body).toMatchObject({
			error: 'temporarily_unavailable',
			error_description: 'socket hang up',
		});
	});
});
