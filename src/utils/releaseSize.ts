/**
 * What a release's recorded size is allowed to be, and one place to say it.
 *
 * The library stores a size per hash in megabytes, and some rows carry bytes or
 * kilobytes there instead — the scrapers behind them disagree about the unit and
 * always have. A 5.65 GB film recorded that way reads as 30.4 TB.
 *
 * That would be harmless if nothing ranked on size, and both readers do. The
 * Stremio addon offers releases biggest-first, and so does the Torznab feed —
 * so a single mis-united row does not sit quietly at the bottom of a page, it
 * takes the top of it. Measured against the live feed on 2026-09-09: the first
 * result of a `Sicario` search was `Sicario 2015 1080p BluRay x264-OFT` at
 * 30,408.7 GB, whose real size is 5.65 GB, and the first result for
 * `Severance` season 1 was an episode reported at the same 30,408.7 GB against
 * a real 2.00 GB.
 *
 * Kept here rather than in either reader because two copies of a threshold
 * eventually disagree, and a reader that disagreed with the other about what
 * counts as a real release would show a different library to the same person.
 */

/** Junk floor, in MB. Shared with the cast pool's `size > 10` filter. */
export const MIN_SIZE_MB = 10;

/**
 * Noise ceiling, in MB. No real single-video release is half a terabyte, so a
 * size above this is a unit the row was not stored in.
 */
export const MAX_SIZE_MB = 500 * 1024;
