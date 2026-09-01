// TorBox web downloads (direct/hoster links TorBox fetches for the user) share
// the DMM library with torrents, but their numeric ids come from a different
// TorBox table and overlap torrent ids. Library rows therefore carry a `tb:w`
// prefix instead of a plain `tb:` one — still a TorBox row for every
// `startsWith('tb:')` check, but distinguishable where it matters.
export const TB_WEB_ID_PREFIX = 'tb:w';

export const toWebDownloadRowId = (webDownloadId: number | string): string =>
	`${TB_WEB_ID_PREFIX}${webDownloadId}`;

export const isWebDownloadRowId = (rowId: string): boolean => rowId.startsWith(TB_WEB_ID_PREFIX);

/** Numeric TorBox id behind a `tb:123` (torrent) or `tb:w123` (web download) row id. */
export const parseTorBoxRowId = (rowId: string): number =>
	parseInt(rowId.replace(/^tb:w?/, ''), 10);

/**
 * TorBox keeps three separate download tables, and their numeric ids overlap.
 * Only the prefix tells them apart.
 */
export type TorBoxItemKind = 'torrent' | 'webdl' | 'usenet';

const KIND_BY_PREFIX: Record<string, TorBoxItemKind> = { w: 'webdl', u: 'usenet' };

/**
 * Path segment naming a TorBox item: `123` for a torrent, `w123` for a web
 * download, `u123` for a usenet download.
 *
 * `isWebDownload` is kept alongside `kind` because the cast route only ever
 * distinguishes those two - a cast is never a usenet download.
 */
export const parseTorBoxCastTarget = (
	idPart: string
): { id: number; kind: TorBoxItemKind; isWebDownload: boolean } | null => {
	const kind = KIND_BY_PREFIX[idPart.charAt(0)] ?? 'torrent';
	const id = parseInt(kind === 'torrent' ? idPart : idPart.substring(1), 10);
	if (isNaN(id)) return null;
	return { id, kind, isWebDownload: kind === 'webdl' };
};

/**
 * TorBox hashes a web download with md5 (32 hex) while a torrent keeps its
 * 40-hex sha1 infohash. That length gap is what lets the cast and play routes
 * tell a stored web-download cast from a torrent cast without a schema change.
 */
export const isWebDownloadHash = (hash: string): boolean => /^[a-f0-9]{32}$/i.test(hash);
