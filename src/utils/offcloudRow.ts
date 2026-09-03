/**
 * Offcloud library rows.
 *
 * Offcloud has one row shape and one handle for it: the `requestId` that
 * `POST /api/cloud` mints and that `cloud/status`, `cloud/explore` and
 * `cloud/remove` all address. There is no Premiumize-style split between
 * transfers, folders and loose files - the cloud item *is* the row - so this
 * carries no kind character, only the prefix the rest of the library branches
 * on.
 *
 * The prefix has to be exactly three characters (`oc:`), the same as `rd:`,
 * `ad:`, `tb:` and `pm:`: several places slice a row id with `substring(0, 3)`
 * or `substring(3)` rather than parsing it.
 */

export const OC_ID_PREFIX = 'oc:';

export const toOffcloudRowId = (requestId: string): string => `${OC_ID_PREFIX}${requestId}`;

export const isOffcloudRowId = (rowId: string): boolean => rowId.startsWith(OC_ID_PREFIX);

/**
 * The request id inside a row id, or null for anything that is not an Offcloud
 * row. A bare `oc:` addresses nothing, and handing an empty id to
 * `cloud/remove` would be a destructive call against an unknown item, so it is
 * refused here rather than passed on.
 */
export const parseOffcloudRowId = (rowId: string): string | null => {
	if (!isOffcloudRowId(rowId)) return null;
	const requestId = rowId.slice(OC_ID_PREFIX.length);
	return requestId.length > 0 ? requestId : null;
};
