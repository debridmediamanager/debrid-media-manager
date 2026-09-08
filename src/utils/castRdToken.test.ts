import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetToken } = vi.hoisted(() => ({ mockGetToken: vi.fn() }));

vi.mock('@/services/realDebrid', () => ({
	getToken: mockGetToken,
}));

import { castAccessToken } from './castRdToken';

describe('castAccessToken', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetToken.mockResolvedValue({ access_token: 'minted' });
	});

	// The whole point of the API-key path: the key is already a bearer token
	// for the same REST API, with no expiry and no OAuth credentials to renew
	// it with, so there is nothing to exchange.
	it('returns a stored API key without calling Real-Debrid', async () => {
		const token = await castAccessToken({
			apiKey: 'pasted-key',
			clientId: null,
			clientSecret: null,
			refreshToken: null,
		});

		expect(token).toBe('pasted-key');
		expect(mockGetToken).not.toHaveBeenCalled();
	});

	it('mints a fresh token from the OAuth triple', async () => {
		const token = await castAccessToken({
			apiKey: null,
			clientId: 'id',
			clientSecret: 'secret',
			refreshToken: 'refresh',
		});

		expect(token).toBe('minted');
		expect(mockGetToken).toHaveBeenCalledWith('id', 'secret', 'refresh', true);
	});

	// An API key that outlives a revoked grant is the current credential, and
	// `saveCastProfile` nulls the triple when one replaces the other anyway.
	it('prefers the API key when a profile somehow carries both', async () => {
		const token = await castAccessToken({
			apiKey: 'pasted-key',
			clientId: 'id',
			clientSecret: 'secret',
			refreshToken: 'refresh',
		});

		expect(token).toBe('pasted-key');
		expect(mockGetToken).not.toHaveBeenCalled();
	});

	// `getToken` posts the refresh token as the OAuth `code`, so an incomplete
	// triple can only ever come back as a 400 - which the callers would read as
	// an expired grant and tell the user to re-authenticate for no reason.
	it('returns null on an incomplete triple rather than calling Real-Debrid', async () => {
		for (const partial of [
			{ clientId: 'id', clientSecret: 'secret', refreshToken: null },
			{ clientId: 'id', clientSecret: null, refreshToken: 'refresh' },
			{ clientId: null, clientSecret: 'secret', refreshToken: 'refresh' },
			{ clientId: null, clientSecret: null, refreshToken: null },
		]) {
			expect(await castAccessToken({ apiKey: null, ...partial })).toBeNull();
		}
		expect(mockGetToken).not.toHaveBeenCalled();
	});

	it('passes a Real-Debrid refresh failure through to the caller', async () => {
		mockGetToken.mockRejectedValue(new Error('grant revoked'));

		await expect(
			castAccessToken({
				apiKey: null,
				clientId: 'id',
				clientSecret: 'secret',
				refreshToken: 'refresh',
			})
		).rejects.toThrow('grant revoked');
	});
});
