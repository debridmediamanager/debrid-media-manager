/**
 * Who a content report is from.
 *
 * Reports are counted per account. This is the credential the server asks its
 * service about before filing anything (`verifiedReporterId`); Real-Debrid,
 * AllDebrid and TorBox keys go as-is and the other services' are tagged.
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
