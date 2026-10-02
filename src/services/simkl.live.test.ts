import { describe, expect, it } from 'vitest';
import { SimklError } from './simkl';
import { getSimklList, getSimklUser, getSimklUserLists } from './simklProvider';

/**
 * Opt-in checks against a real Simkl account.
 *
 * Kept out of `npm run test` on purpose - see `vitest.live.config.ts`. Run with:
 *
 *	SIMKL_V2_CLIENT_ID=<v2 client id> SIMKL_LIVE_TOKEN=<access token> \
 *	  npx vitest run --config vitest.live.config.ts
 *
 * The token must come from a real AUTH V2 grant, via the authorization-code
 * (PKCE plus consent) or device-code flow. The
 * list checks additionally need that account to be on Simkl PRO or VIP, and skip
 * themselves with a message rather than failing when it is not - a free account
 * is refused with an HTTP 200, which is exactly the shape the unit tests cover
 * from a fixture.
 */

const CLIENT_ID = process.env.SIMKL_V2_CLIENT_ID;

const TOKEN = process.env.SIMKL_LIVE_TOKEN;
const enabled = !!TOKEN && !!CLIENT_ID;

describe.skipIf(!enabled)('Simkl AUTH V2, live', () => {
	it('reads the signed-in account', async () => {
		const profile = await getSimklUser(TOKEN!);
		expect(profile.account.id).toBeGreaterThan(0);
		expect(['free', 'pro', 'vip']).toContain(profile.account.type);
		console.log(`[live] signed-in account on ${profile.account.type}`);
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

			// Compare the complete item walk with the provider's total, within
			// its documented 10,000-item reachable window.
			if (lists.length > 0) {
				const list = await getSimklList(TOKEN!, lists[0].id);
				expect(list.id).toBe(lists[0].id);
				expect(Array.isArray(list.items)).toBe(true);
				if (list.counts) {
					expect(list.items.length).toBe(Math.min(list.counts.items, 10000));
				}
				const withImdb = list.items.filter((item) => item.ids?.imdb).length;
				console.log(`[live] list: ${list.items.length} items, ${withImdb} with an IMDb id`);
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
