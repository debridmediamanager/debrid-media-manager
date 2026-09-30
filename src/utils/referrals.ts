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
 * `aff` cookie and lands on the plans page.
 */
export const REAL_DEBRID_REFERRAL_ID = '20474106';
export const REAL_DEBRID_REFERRAL_URL = `http://real-debrid.com/?id=${REAL_DEBRID_REFERRAL_ID}`;
export const REAL_DEBRID_PREMIUM_REFERRAL_URL = `https://real-debrid.com/premium?id=${REAL_DEBRID_REFERRAL_ID}`;
