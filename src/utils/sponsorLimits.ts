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

export interface OtherStreamsLimitChoice {
	value: number;
	/** Above the caller's ceiling: shown, but not selectable. */
	sponsorOnly: boolean;
}

/**
 * Every value the "Other streams limit" dropdown shows, and which of them a
 * sponsorship is what opens.
 *
 * The sponsor-only values used to be missing from the list entirely, which hid
 * the perk from exactly the people it is meant to reach: a non-sponsor saw a
 * dropdown that stopped at 5 and no reason to think it went further. They are
 * listed and disabled instead. The ceiling is unchanged, and the server checks
 * it again on every save, so this only decides what is on screen.
 *
 * `current` is kept in the list even when it sits above the ceiling, which is
 * what a sponsor who set 10 and then lapsed will have stored. Dropping it would
 * render the select blank and silently misreport what the profile actually holds.
 */
export function otherStreamsLimitChoices(
	isSponsor: boolean,
	current?: number
): OtherStreamsLimitChoice[] {
	const ceiling = maxOtherStreamsLimit(isSponsor);
	const choices = Array.from(
		{ length: SPONSOR_MAX_OTHER_STREAMS_LIMIT + 1 },
		(_, value): OtherStreamsLimitChoice => ({ value, sponsorOnly: value > ceiling })
	);
	if (
		typeof current === 'number' &&
		Number.isInteger(current) &&
		current > SPONSOR_MAX_OTHER_STREAMS_LIMIT
	) {
		choices.push({ value: current, sponsorOnly: current > ceiling });
	}
	return choices;
}

/** The dropdown label for one choice. */
export function otherStreamsLimitLabel({ value, sponsorOnly }: OtherStreamsLimitChoice): string {
	const base =
		value === 0 ? `Don't show other streams` : value === 1 ? '1 stream' : `${value} streams`;
	return sponsorOnly ? `${base} (sponsors only)` : base;
}
