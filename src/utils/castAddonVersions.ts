/**
 * Published version of each DMM Cast addon.
 *
 * Stremio stores an addon's manifest at install time and keeps serving from
 * that stored copy; the `version` field is what tells a client the descriptor
 * it holds is stale. So anything a client reads out of the manifest - a new
 * catalog, a new resource, a new type - only reaches existing installs once
 * this number moves.
 *
 * Kept here rather than inline because each addon publishes **two** manifests,
 * the normal one and the `no-catalog` variant, under the **same addon id**. Two
 * literals under one id can drift, and a client that has seen both then
 * disagrees with itself about which version is installed.
 */
export const CAST_ADDON_VERSIONS = {
	/** Real-Debrid. 0.0.6: library ids belonging to a sibling addon are handed back. */
	realdebrid: '0.0.6',
	/** TorBox. 0.0.2: the library catalog now lists web downloads and usenet downloads. */
	torbox: '0.0.2',
	/** AllDebrid. 0.0.2: the library pages past its first twelve entries, and lists saved links. */
	alldebrid: '0.0.2',
	/** Premiumize. 0.0.2: adds the library catalog, its `other` type and its meta resource. */
	premiumize: '0.0.2',
	/** Offcloud. 0.0.1: first publish. */
	offcloud: '0.0.1',
	/** Debrid-Link. 0.0.1: first publish. */
	debridlink: '0.0.1',
} as const;
