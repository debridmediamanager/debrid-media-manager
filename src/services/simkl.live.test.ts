import { describe, expect, it, vi } from 'vitest';

/**
 * Opt-in checks against a real Simkl account.
 *
 * Kept out of `npm run test` on purpose - see `vitest.live.config.ts`. Run with:
 *
 *	SIMKL_V2_CLIENT_ID=<v2 client id> SIMKL_LIVE_TOKEN=<access token> \
 *	  npx vitest run --config vitest.live.config.ts
 *
 * The token has to come from a real AUTH V2 browser login; there is no way to
 * mint one from a script, because V2 requires PKCE and a consent screen. The
 * list checks additionally need that account to be on Simkl PRO or VIP, and skip
 * themselves with a message rather than failing when it is not - a free account
 * is refused with an HTTP 200, which is exactly the shape the unit tests cover
 * from a fixture.
 */

const { CLIENT_ID } = vi.hoisted(() => ({
	CLIENT_ID: process.env.SIMKL_V2_CLIENT_ID ?? '',
}));

vi.mock('next/config', () => ({
	default: () => ({ publicRuntimeConfig: { simklClientId: CLIENT_ID } }),
}));

import { SimklError, getSimklList, getSimklUser, getSimklUserLists } from './simkl';

const TOKEN = process.env.SIMKL_LIVE_TOKEN;
const enabled = !!TOKEN && !!CLIENT_ID;

describe.skipIf(!enabled)('Simkl AUTH V2, live', () => {
	it('reads the signed-in account', async () => {
		const profile = await getSimklUser(TOKEN!);
		expect(profile.account.id).toBeGreaterThan(0);
		expect(['free', 'pro', 'vip']).toContain(profile.account.type);
		console.log(`[live] signed in as ${profile.user.name} on ${profile.account.type}`);
	});

	it('reads the account’s custom lists, or reports the tier that blocks it', async () => {
		const profile = await getSimklUser(TOKEN!);
		try {
			const lists = await getSimklUserLists(TOKEN!, profile.account.id);
			expect(Array.isArray(lists)).toBe(true);
			for (const list of lists) {
				expect(list.id).toBeGreaterThan(0);
				expect(typeof list.name).toBe('string');
			}
			console.log(`[live] ${lists.length} custom lists`);

			// Reading one list proves the paging walk and the item shape, which a
			// list of lists does not.
			if (lists.length > 0) {
				const list = await getSimklList(TOKEN!, lists[0].id);
				expect(list.id).toBe(lists[0].id);
				expect(Array.isArray(list.items)).toBe(true);
				const withImdb = list.items.filter((item) => item.ids?.imdb).length;
				console.log(
					`[live] "${list.name}": ${list.items.length} items, ${withImdb} with an IMDb id`
				);
			}
		} catch (error) {
			if (error instanceof SimklError && error.isPremiumOnly) {
				console.log(
					`[live] custom lists refused: account type is ${profile.account.type}, needs pro or vip`
				);
				return;
			}
			throw error;
		}
	});
});
