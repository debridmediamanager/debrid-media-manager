/**
 * Where every Real-Debrid download link DMM stores begins. The RD Cast stream
 * route strips exactly this from a stored link to build a play URL, and the
 * play route puts it back in front of the id.
 */
export const RD_DOWNLOAD_LINK_PREFIX = 'https://real-debrid.com/d/';

/**
 * Whether a play URL can carry an RD download id: a 13-character content key
 * with an optional alphanumeric account binding. Current links use a 3-character
 * binding; historical links used 13. Longer IDs are accepted defensively, not
 * because 26-character links occur in the current DMM database.
 * Shorter ids are unsafe for the play route's prefix-based cleanup.
 */
export function isRdLinkId(id: string): boolean {
	return /^[A-Za-z0-9]{13,}$/.test(id);
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
	return isRdLinkId(id) ? id.slice(0, 13) : null;
}
