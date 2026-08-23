import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	PremiumizeOAuthError,
	pollPremiumizeDeviceToken,
	requestPremiumizeDeviceCode,
} from './premiumizeOAuth';

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

describe('requestPremiumizeDeviceCode', () => {
	it('goes through DMM, never straight to premiumize.me', async () => {
		// /token sends no access-control-allow-origin at all, so a browser
		// cannot read the response cross-origin.
		fetchMock.mockResolvedValue(
			jsonResponse({
				user_code: 'uwu3-67m4',
				device_code: 'dc',
				interval: 5,
				expires_in: 600,
			})
		);

		const code = await requestPremiumizeDeviceCode();

		expect(fetchMock.mock.calls[0][0]).toBe('/api/premiumize-oauth/device');
		expect(code.user_code).toBe('uwu3-67m4');
	});

	it('surfaces an OAuth error with its error code intact', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ error: 'invalid_client', error_description: 'bad client' }, 400)
		);

		await expect(requestPremiumizeDeviceCode()).rejects.toBeInstanceOf(PremiumizeOAuthError);
		await expect(requestPremiumizeDeviceCode()).rejects.toMatchObject({
			error: 'invalid_client',
			message: 'bad client',
		});
	});
});

describe('pollPremiumizeDeviceToken', () => {
	it('returns the token once the user approves', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ access_token: 'tok', token_type: 'bearer', expires_in: 315360000 })
		);

		const token = await pollPremiumizeDeviceToken('dc');

		expect(token?.access_token).toBe('tok');
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ device_code: 'dc' });
	});

	it('treats authorization_pending as "keep waiting", not a failure', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ error: 'authorization_pending' }, 400));

		await expect(pollPremiumizeDeviceToken('dc')).resolves.toBeNull();
	});

	it('reports slow_down to the caller so the interval can grow', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ error: 'slow_down' }, 400));
		const onSlowDown = vi.fn();

		await expect(pollPremiumizeDeviceToken('dc', onSlowDown)).resolves.toBeNull();
		expect(onSlowDown).toHaveBeenCalledTimes(1);
	});

	it('gives up when the user declines', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ error: 'access_denied' }, 400));

		await expect(pollPremiumizeDeviceToken('dc')).rejects.toMatchObject({
			error: 'access_denied',
		});
	});

	it('gives up when the device code expired or is unknown', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ error: 'invalid_grant', error_description: "doesn't exist" }, 400)
		);

		await expect(pollPremiumizeDeviceToken('dc')).rejects.toMatchObject({
			error: 'invalid_grant',
		});
	});
});
