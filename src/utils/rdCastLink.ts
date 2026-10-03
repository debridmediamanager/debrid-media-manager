/**
 * Where every Real-Debrid download link DMM stores begins. The RD Cast stream
 * route strips exactly this from a stored link to build a play URL, and the
 * play route puts it back in front of the id.
 */
export const RD_DOWNLOAD_LINK_PREFIX = 'https://real-debrid.com/d/';

/**
 * Whether a play URL's id can be a Real-Debrid download id: 13 characters of
 * content key, optionally followed by the 3-character account tag. On
 * 2026-10-03 every one of the 5.9M links stored in `AvailableFile` and `Cast`
 * had a 13- or 16-character id of letters and digits. Anything shorter would
 * also turn the play route's prefix cleanup into a delete of every link that
 * starts with it.
 */
export function isRdLinkId(id: string): boolean {
	return /^[A-Za-z0-9]{13,16}$/.test(id);
}

/**
 * The id an RD Cast play URL carries for a stored link, or null when the link
 * is not a Real-Debrid download link and so cannot be played by unrestricting.
 *
 * `AvailableFile` holds such rows on purpose: Real-Debrid availability learned
 * from Debridio is filed under a `debridio:{hash}` marker
 * (`saveInstantAvailability`), because nobody has the torrent in an account and
 * there is no link. Cutting 26 characters off that marker handed the play route
 * a slice of the infohash.
 */
export function rdCastPlayId(link: string | null | undefined): string | null {
	if (!link?.startsWith(RD_DOWNLOAD_LINK_PREFIX)) return null;
	const id = link.slice(RD_DOWNLOAD_LINK_PREFIX.length);
	return isRdLinkId(id) ? id : null;
}
