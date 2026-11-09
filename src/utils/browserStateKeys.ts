/**
 * What "remember my logins and settings across devices" carries.
 *
 * DMM has no accounts, so the identity a new browser proves is a provider
 * login, the step it already takes today. The state behind that login is the
 * raw localStorage strings of these keys, so `{ value, expiry }` envelopes and
 * the saved-accounts lists round-trip untouched. Both the browser (collect and
 * apply) and the server (refuse anything else) read this one list, so a key
 * that is not named here is never stored.
 *
 * Left out on purpose: `*:castToken` (re-minted from the credential), the
 * cast `*:castSyncedKey` markers, `dmm:guest`, the music player, job queues,
 * `library:lastSync*` and one-off warnings - all of them are per-browser state.
 */
export const SYNCED_KEYS = [
	'rd:clientId',
	'rd:clientSecret',
	'rd:refreshToken',
	'rd:accessToken',
	'tb:apiKey',
	'ad:apiKey',
	'pm:apiKey',
	'pm:accessToken',
	'oc:apiKey',
	'dl:apiKey',
	'dl:accessToken',
	'dl:refreshToken',
	'dl:tokenExpiry',
	'dmm:sponsorToken',
	'dmm:apiKey',
	'trakt:accessToken',
	'trakt:refreshToken',
	'trakt:userSlug',
	'en:account',
] as const;

/**
 * The provider sign-ins among them, as withAuth counts them (src/utils/withAuth.tsx).
 * Easynews alone is not one: withAuth wants a debrid service.
 */
export const SIGN_IN_KEYS = [
	'rd:accessToken',
	'rd:refreshToken',
	'ad:apiKey',
	'tb:apiKey',
	'pm:accessToken',
	'pm:apiKey',
	'oc:apiKey',
	'dl:accessToken',
	'dl:apiKey',
] as const;

/** Prefixes: every `settings:*` flag and the parked logins of the account switcher. */
export const SYNCED_PREFIXES = ['settings:', 'dmm:accounts:'] as const;

/** The opt-in flag. A `settings:` key, so it rides along and a restored browser keeps syncing. */
export const SYNC_ENABLED_KEY = 'settings:syncAcrossDevices';

/** Upper bound on a serialized state blob; the real ones are a few KB. */
export const MAX_STATE_BYTES = 64 * 1024;

/** The debrid providers, and `dmm` for the sponsor key: an NZB-only sponsor has no other login. */
export const SYNC_SERVICES = ['rd', 'tb', 'ad', 'pm', 'oc', 'dl', 'dmm'] as const;
export type SyncService = (typeof SYNC_SERVICES)[number];

export function isSyncedKey(key: string): boolean {
	return (
		(SYNCED_KEYS as readonly string[]).includes(key) ||
		SYNCED_PREFIXES.some((prefix) => key.startsWith(prefix))
	);
}

/** Raw localStorage strings keyed by localStorage key. */
export type BrowserState = Record<string, string>;

/**
 * One login, as the server verifies it: Real-Debrid is either the device-code
 * triple or a pasted key; every other provider is one bearer credential (for
 * Premiumize and Debrid-Link the OAuth token when there is one, else the pasted
 * key, matching `usePremiumizeCredential`); `dmm` is the gatekeeper API key.
 */
export type SyncIdentity =
	| { service: 'rd'; clientId: string; clientSecret: string; refreshToken: string }
	| { service: 'rd'; apiKey: string }
	| { service: Exclude<SyncService, 'rd'>; apiKey: string };

/** The synced keys of a state someone sent, string values only; everything else is dropped. */
export function pickSyncedState(sent: unknown): BrowserState {
	const entries = sent && typeof sent === 'object' ? Object.entries(sent) : [];
	return Object.fromEntries(
		entries.filter(
			(entry): entry is [string, string] =>
				isSyncedKey(entry[0]) && typeof entry[1] === 'string'
		)
	);
}

/** The debrid services a state is signed in to, e.g. ['rd', 'pm']. */
export function signedInServices(state: BrowserState): string[] {
	return [...new Set(SIGN_IN_KEYS.filter((key) => state[key]).map((key) => key.split(':')[0]))];
}
