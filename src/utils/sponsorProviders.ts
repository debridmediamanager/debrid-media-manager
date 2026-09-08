/**
 * The debrid providers a sponsor can link a key for, and how that key is shown
 * back to them.
 *
 * Real-Debrid and AllDebrid are deliberately not here. Their availability is
 * answered from DMM's own `Available` and `AvailableAd` tables, so those feeds
 * need no credential from anyone and must not start asking for one.
 *
 * Debrid-Link is not here either, and not by omission: its API has no
 * non-mutating availability check at all. The only way to learn whether it holds
 * a hash is to add the hash, which spends the caller's quota and changes their
 * library. A feed that did that on every search would be a bill, not a filter.
 *
 * Kept free of any server import so the settings UI can render the list.
 */

export const TORZNAB_LIVE_SERVICES = ['tb', 'pm', 'oc'] as const;

export type TorznabLiveService = (typeof TORZNAB_LIVE_SERVICES)[number];

export const LIVE_SERVICE_LABELS: Record<TorznabLiveService, string> = {
	tb: 'TorBox',
	pm: 'Premiumize',
	oc: 'Offcloud',
};

/** Where each provider's key is found, for the settings form's hint. */
export const LIVE_SERVICE_KEY_SOURCES: Record<TorznabLiveService, string> = {
	tb: 'torbox.app → Settings → API key',
	pm: 'premiumize.me → My Account → API key',
	oc: 'offcloud.com → Account → API key',
};

export function isTorznabLiveService(value: unknown): value is TorznabLiveService {
	return (
		typeof value === 'string' && (TORZNAB_LIVE_SERVICES as readonly string[]).includes(value)
	);
}

/**
 * Enough of a key to recognise which one is linked, never enough to use it.
 *
 * The same shape `maskApiKey` gives the DMM key on the indexer setup pages, for
 * the same reason: this panel is on screen while someone wires up their stack.
 */
export function maskProviderKey(apiKey: string): string {
	if (apiKey.length <= 12) return '•'.repeat(apiKey.length);
	return `${apiKey.slice(0, 4)}${'•'.repeat(8)}${apiKey.slice(-4)}`;
}
