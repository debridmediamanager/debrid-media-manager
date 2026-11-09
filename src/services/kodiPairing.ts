import * as pairing from './devicePairing';

export {
	PAIRING_TTL_SECONDS,
	POLL_INTERVAL_SECONDS,
	formatUserCode,
	normalizeUserCode,
	type ApproveResult,
} from './devicePairing';

/**
 * Linking a Kodi (see devicePairing): the browser approves with the DMM Cast addons and
 * sponsor key it holds, and Kodi collects them once.
 */

export interface KodiAccount {
	service: string;
	name: string;
	/**
	 * The DMM Cast addon base, `<origin>/api/stremio[-xx]/<userid>`. Approval passes only the
	 * path; the pairing puts the address Kodi paired through in front of it.
	 */
	addon: string;
}

export interface KodiLink {
	accounts: KodiAccount[];
	sponsor: { apiKey: string; githubUsername: string } | null;
}

/**
 * `ip` is where Kodi asked from, so approval can tell when the browser is somewhere else;
 * `origin` the address it asked at, which its addon links are built on.
 */
export const createPairing = (ip: string, origin: string) =>
	pairing.createPairing('kodi', ip, origin);

export const approvePairing = (
	userCode: string,
	link: KodiLink,
	ip: string,
	confirmedOtherNetwork = false
) =>
	pairing.approvePairing(
		'kodi',
		userCode,
		(origin) => ({
			...link,
			accounts: link.accounts.map((a) => ({ ...a, addon: origin + a.addon })),
		}),
		ip,
		confirmedOtherNetwork
	);

export const collectPairing = (deviceCode: string) =>
	pairing.collectPairing<KodiLink>('kodi', deviceCode);
