import { AxiosError } from 'axios';

/**
 * RD errors that mean this particular link will never work again.
 *
 * - `hoster_unavailable`: the link aged out. RD's `/d/` links decay - measured
 *   2026-08-24 over a sample of stored cast links, roughly a quarter were
 *   already dead at 30 days, half by 90, and only 2 of 12 survived 21 months.
 * - `unavailable_file`: RD evicted the content itself, for everyone.
 *
 * Everything else is transient and must not be treated as rot. `/unrestrict/link`
 * carries its own tight, undocumented throttle that answers `too_many_requests`
 * (error 34) after only a handful of calls seconds apart - exactly the shape of
 * Stremio resolving several streams at once - and a 5xx is just a bad minute.
 * Deleting a row on either would throw away content that is perfectly alive.
 */
const PERMANENT_LINK_ERRORS = new Set(['hoster_unavailable', 'unavailable_file']);

export const rdErrorOf = (error: unknown): string | null => {
	if (error instanceof AxiosError) {
		const data = error.response?.data as { error?: string } | undefined;
		return data?.error ?? null;
	}
	return null;
};

export const isDeadRdLink = (error: unknown): boolean => {
	const code = rdErrorOf(error);
	return code !== null && PERMANENT_LINK_ERRORS.has(code);
};

/**
 * How long a stored RD link is offered for.
 *
 * `getUserCastStreams` has always used 30 days; the pool of other users' casts
 * and the shared availability tables had no bound at all, which is how a stream
 * list came to offer links minted in 2024. Same number everywhere so there is
 * one thing to change.
 */
export const RD_LINK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const rdLinkCutoff = () => new Date(Date.now() - RD_LINK_MAX_AGE_MS);
