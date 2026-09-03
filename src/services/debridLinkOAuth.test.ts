import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DebridLinkOAuthError,
	deviceVerificationUri,
	pollDebridLinkDeviceToken,
	refreshDebridLinkToken,
	requestDebridLinkDeviceCode,
} from './debridLinkOAuth';

const jsonResponse = (body: unknown, status = 200) =>
	({ ok: status < 400, status, json: async () => body }) as unknown as Response;

const fetchMock = vi.fn();

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('requestDebridLinkDeviceCode', () => {
	it('goes through DMM, which owns the client id and the scope list', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				device_code: 'dc',
				user_code: 'ABCD-1234',
				interval: 5,
				expires_in: 1800,
			})
		);

		const code = await requestDebridLinkDeviceCode();

		expect(fetchMock.mock.calls[0][0]).toBe('/api/debridlink-oauth/device');
		expect(code.user_code).toBe('ABCD-1234');
	});

	it('surfaces an OAuth error with its error code intact', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(
				{ error: 'invalid_client', error_description: 'The client_id is invalid' },
				400
			)
		);

		await expect(requestDebridLinkDeviceCode()).rejects.toBeInstanceOf(DebridLinkOAuthError);
		await expect(requestDebridLinkDeviceCode()).rejects.toMatchObject({
			error: 'invalid_client',
			message: 'The client_id is invalid',
		});
	});

	it('reports a non-JSON answer rather than throwing on the parse', async () => {
		fetchMock.mockResolvedValue({
			ok: false,
			status: 502,
			json: async () => {
				throw new SyntaxError('nope');
			},
		} as unknown as Response);

		await expect(requestDebridLinkDeviceCode()).rejects.toMatchObject({
			error: 'non_json_response',
		});
	});
});

describe('deviceVerificationUri', () => {
	// The vendor's field name is not settled: RFC 8628 spells it
	// `verification_uri`, the older Google device flow this grant type comes
	// from spells it `verification_url`. Read whichever arrives.
	it('takes the RFC spelling first', () => {
		expect(
			deviceVerificationUri({
				verification_uri: 'https://debrid-link.fr/a',
				verification_url: 'https://debrid-link.fr/b',
			})
		).toBe('https://debrid-link.fr/a');
	});

	it('falls back to the older spelling', () => {
		expect(deviceVerificationUri({ verification_url: 'https://debrid-link.fr/b' })).toBe(
			'https://debrid-link.fr/b'
		);
	});

	it('still gives the user somewhere to go when neither is sent', () => {
		expect(deviceVerificationUri({})).toBe('https://debrid-link.fr/webapp/device');
	});
});

describe('pollDebridLinkDeviceToken', () => {
	it('returns the token once the user approves', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				access_token: 'tok',
				token_type: 'Bearer',
				expires_in: 604800,
				refresh_token: 'rtok',
			})
		);

		const token = await pollDebridLinkDeviceToken('dc');

		expect(token?.access_token).toBe('tok');
		expect(token?.refresh_token).toBe('rtok');
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ device_code: 'dc' });
	});

	it('treats authorization_pending as "keep waiting", not a failure', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ error: 'authorization_pending' }, 400));

		await expect(pollDebridLinkDeviceToken('dc')).resolves.toBeNull();
	});

	it('reports slow_down to the caller so the interval can grow', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ error: 'slow_down' }, 400));
		const onSlowDown = vi.fn();

		await expect(pollDebridLinkDeviceToken('dc', onSlowDown)).resolves.toBeNull();
		expect(onSlowDown).toHaveBeenCalledTimes(1);
	});

	it('gives up when the user declines', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(
				{
					error: 'access_denied',
					error_description: 'The resource owner denied the request',
				},
				403
			)
		);

		await expect(pollDebridLinkDeviceToken('dc')).rejects.toMatchObject({
			error: 'access_denied',
		});
	});

	it('gives up when the device code expired', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ error: 'expired_token' }, 400));

		await expect(pollDebridLinkDeviceToken('dc')).rejects.toMatchObject({
			error: 'expired_token',
		});
	});
});

describe('refreshDebridLinkToken', () => {
	it('sends the refresh token to its own action', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ access_token: 'fresh', token_type: 'Bearer', expires_in: 604800 })
		);

		const token = await refreshDebridLinkToken('rtok');

		expect(fetchMock.mock.calls[0][0]).toBe('/api/debridlink-oauth/refresh');
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ refresh_token: 'rtok' });
		expect(token.access_token).toBe('fresh');
	});

	// A dead refresh token is the end of the session, not something to retry.
	it('surfaces a refused refresh token', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid_request' }, 400));

		await expect(refreshDebridLinkToken('stale')).rejects.toMatchObject({
			error: 'invalid_request',
		});
	});
});
