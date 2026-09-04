/**
 * Sign-up links that credit DMM's referral. Kept in one place so the referral id
 * cannot drift between the pages that link to it.
 */
export const TORBOX_REFERRAL_URL =
	'https://torbox.app/subscription?referral=74ffa560-7381-4a18-adb1-cef97378c670';

/**
 * Debrid-Link's referral host is `debrid-link.com`, not the `debrid-link.fr` the
 * API and OAuth endpoints use. Following it sets an `a_id=diG1t` cookie that
 * attributes a sign-up for 30 days. Do not "correct" the domain to match the API.
 */
export const DEBRID_LINK_REFERRAL_URL = 'https://debrid-link.com/id/diG1t';
