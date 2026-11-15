export const OFFICIAL_HOST = /(^|\.)debridmediamanager\.com$/i;

/**
 * Whether this copy of DMM is the one at debridmediamanager.com. A self-hosted copy
 * must not reach for DMM's own hosts (RD proxies, unrestrict worker) with its users'
 * tokens, so those calls stay on its own server instead. The browser goes by the page's
 * host; the server by DMM_ORIGIN, which production sets and .env.example points elsewhere.
 */
export function isOfficialDmm(): boolean {
	if (typeof window !== 'undefined') return OFFICIAL_HOST.test(window.location.hostname);
	try {
		return OFFICIAL_HOST.test(new URL(process.env.DMM_ORIGIN ?? '').hostname);
	} catch {
		return false;
	}
}
