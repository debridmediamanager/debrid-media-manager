/**
 * Who a content report is from.
 *
 * Reports are counted per reporter, so the id only has to be stable and
 * distinct per account. Real-Debrid, AllDebrid and TorBox users have always
 * been identified by their key as-is, and the admin override matches one such
 * key, so those stay unchanged. The other services were never allowed to
 * report at all; their credential is sent tagged with its service so the
 * server can store a digest of it instead - see `storedReporterId`. The client
 * cannot digest it itself: Web Crypto is missing outside a secure context.
 */
export type ReporterKeys = {
	rdKey?: string | null;
	adKey?: string | null;
	torboxKey?: string | null;
	premiumizeKey?: string | null;
	offcloudKey?: string | null;
	debridLinkKey?: string | null;
};

export function reporterIdFor(keys: ReporterKeys): string {
	if (keys.rdKey) return keys.rdKey;
	if (keys.adKey) return keys.adKey;
	if (keys.torboxKey) return keys.torboxKey;
	if (keys.premiumizeKey) return `pm:${keys.premiumizeKey}`;
	if (keys.offcloudKey) return `oc:${keys.offcloudKey}`;
	if (keys.debridLinkKey) return `dl:${keys.debridLinkKey}`;
	return '';
}

export const canReportWith = (keys: ReporterKeys) => reporterIdFor(keys) !== '';
