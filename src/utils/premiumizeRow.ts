/**
 * Premiumize library rows.
 *
 * Premiumize is a cloud filesystem with a transfer queue bolted on, and the two
 * come apart: `transfer/clearfinished` empties the transfer list while leaving
 * every file in place, so a user who has ever tidied their transfers has content
 * that no transfer knows about. A library built only from `transfer/list` would
 * show them nothing.
 *
 * DMM therefore builds rows from both, and the id prefix records which:
 *
 *  - `pm:t<transferId>` - a live transfer. Carries status and progress, and is
 *    removed with `transfer/delete` (which deletes the files too - that really is
 *    what it does, whatever the vendor documentation says).
 *  - `pm:f<folderId>` - a cloud folder with no transfer behind it any more.
 *    Removed with `folder/delete`.
 *  - `pm:i<fileId>` - a root-level cloud file with no transfer behind it.
 *    Removed with `item/delete`.
 *
 * Every one of them still answers `startsWith('pm:')`, which is what the rest of
 * the library code branches on.
 */

export const PM_ID_PREFIX = 'pm:';

export type PremiumizeRowKind = 'transfer' | 'folder' | 'file';

const KIND_TO_CHAR: Record<PremiumizeRowKind, string> = {
	transfer: 't',
	folder: 'f',
	file: 'i',
};

export const toPremiumizeRowId = (kind: PremiumizeRowKind, id: string): string =>
	`${PM_ID_PREFIX}${KIND_TO_CHAR[kind]}${id}`;

export const isPremiumizeRowId = (rowId: string): boolean => rowId.startsWith(PM_ID_PREFIX);

/**
 * Splits a row id back into what it addresses. Returns null for anything that is
 * not a Premiumize row, or for a `pm:` row written before this scheme existed.
 */
export const parsePremiumizeRowId = (
	rowId: string
): { kind: PremiumizeRowKind; id: string } | null => {
	if (!isPremiumizeRowId(rowId)) return null;
	const rest = rowId.slice(PM_ID_PREFIX.length);
	const kind = (Object.keys(KIND_TO_CHAR) as PremiumizeRowKind[]).find(
		(candidate) => KIND_TO_CHAR[candidate] === rest[0]
	);
	if (!kind || rest.length < 2) return null;
	return { kind, id: rest.slice(1) };
};
