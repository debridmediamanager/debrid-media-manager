import { getSimklSession } from '@/services/simkl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import profile from '../fixtures/simkl/user-settings-200.json';

const account = {
	user: {
		user: { name: profile.user.name, avatar: profile.user.avatar },
		account: { id: profile.account.id, type: profile.account.type },
	},
	cacheKey: '0123456789abcdefghijklmnopqrstuv',
	expiresAt: 1900000000000,
};

afterEach(() => vi.unstubAllGlobals());

describe('SIMKL browser account boundary', () => {
	it('removes unexpected credential-bearing fields from a successful account response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						...account,
						access_token: 'unexpected-access',
						refresh_token: 'unexpected-refresh',
						user: {
							...account.user,
							user: { ...account.user.user, token: 'unexpected-profile-secret' },
						},
					}),
					{ status: 200 }
				)
			)
		);
		expect(await getSimklSession()).toEqual(account);
	});

	it('rejects a malformed account before exposing an unsafe private profile', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						...account,
						user: {
							...account.user,
							account: { ...account.user.account, id: 'another-account' },
						},
					}),
					{ status: 200 }
				)
			)
		);
		await expect(getSimklSession()).rejects.toMatchObject({ code: 'invalid_response' });
	});
});
