/**
 * Cast stream limits, and how far a sponsor may raise them.
 *
 * Kept free of any crypto import so the settings UI can render the sponsor
 * range without pulling node:crypto into the client bundle.
 */

/** What anyone may set "Other streams limit" to. */
export const MAX_OTHER_STREAMS_LIMIT = 5;

/** What an active sponsor may set it to. */
export const SPONSOR_MAX_OTHER_STREAMS_LIMIT = 10;

export function maxOtherStreamsLimit(isSponsor: boolean): number {
	return isSponsor ? SPONSOR_MAX_OTHER_STREAMS_LIMIT : MAX_OTHER_STREAMS_LIMIT;
}

/**
 * Options offered by the "Other streams limit" dropdown, 0 through the caller's
 * ceiling.
 *
 * `current` is kept in the list even when it sits above that ceiling, which is
 * what a sponsor who set 10 and then lapsed will have stored. Dropping it would
 * render the select blank and silently misreport what the profile actually holds.
 */
export function otherStreamsLimitOptions(isSponsor: boolean, current?: number): number[] {
	const ceiling = maxOtherStreamsLimit(isSponsor);
	const options = Array.from({ length: ceiling + 1 }, (_, i) => i);
	if (typeof current === 'number' && Number.isInteger(current) && current > ceiling) {
		options.push(current);
	}
	return options;
}
