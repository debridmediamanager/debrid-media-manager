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
	/** Real-Debrid. 0.0.7: streams anime by `kitsu`, `mal` and `anidb` id. */
	realdebrid: '0.0.7',
	/** TorBox. 0.0.3: streams anime by `kitsu`, `mal` and `anidb` id. */
	torbox: '0.0.3',
	/** AllDebrid. 0.0.3: streams anime by `kitsu`, `mal` and `anidb` id. */
	alldebrid: '0.0.3',
	/** Premiumize. 0.0.3: streams anime by `kitsu`, `mal` and `anidb` id. */
	premiumize: '0.0.3',
	/** Offcloud. 0.0.2: streams anime by `kitsu`, `mal` and `anidb` id. */
	offcloud: '0.0.2',
	/** Debrid-Link. 0.0.2: streams anime by `kitsu`, `mal` and `anidb` id. */
	debridlink: '0.0.2',
} as const;
