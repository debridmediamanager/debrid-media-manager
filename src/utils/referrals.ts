/**
 * Sign-up links that credit DMM's referral. Kept in one place so the referral id
 * cannot drift between the pages that link to it.
 */
/**
 * AllDebrid credits `?uid=` on any page by setting a `parrain` cookie, so the API-key
 * link carries it as well and still lands on the key page.
 */
export const ALLDEBRID_REFERRAL_UID = '1kk5i';
export const ALLDEBRID_REFERRAL_URL = `https://alldebrid.com/?uid=${ALLDEBRID_REFERRAL_UID}&lang=en`;
export const ALLDEBRID_APIKEYS_URL = `https://alldebrid.com/apikeys?uid=${ALLDEBRID_REFERRAL_UID}`;

export const TORBOX_REFERRAL_URL =
	'https://torbox.app/subscription?referral=74ffa560-7381-4a18-adb1-cef97378c670';

/**
 * Debrid-Link's referral host is `debrid-link.com`, not the `debrid-link.fr` the
 * API and OAuth endpoints use. Following it sets an `a_id=diG1t` cookie that
 * attributes a sign-up for 30 days. Do not "correct" the domain to match the API.
 */
export const DEBRID_LINK_REFERRAL_URL = 'https://debrid-link.com/id/diG1t';

/**
 * Real-Debrid credits the referral from `?id=` on any page; `/premium?id=` sets an
 * `aff` cookie and lands on the plans page. The referral id is the account's own
 * user id.
 *
 * Credit is spread evenly across a pool of accounts (each credited sign-up is worth
 * 5 premium days + 50 fidelity points) by picking one at random per call. A random
 * pick is statistically even and needs no shared state, which suits `/start` and the
 * premium prompts since both render client-side.
 */
export const REAL_DEBRID_REFERRAL_IDS = [
	'20475782',
	'20475870',
	'20475970',
	'20476026',
	'20476150',
	'20476198',
	'20476266',
	'20476302',
	'20476354',
	'20476410',
] as const;

export const pickRealDebridReferralId = (): string =>
	REAL_DEBRID_REFERRAL_IDS[Math.floor(Math.random() * REAL_DEBRID_REFERRAL_IDS.length)];

export const realDebridReferralUrl = (): string =>
	`http://real-debrid.com/?id=${pickRealDebridReferralId()}`;

export const realDebridPremiumReferralUrl = (): string =>
	`https://real-debrid.com/premium?id=${pickRealDebridReferralId()}`;
