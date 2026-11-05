import { AxiosError } from 'axios';

/**
 * RD errors the existing cleanup policy treats as dead links.
 *
 * - `hoster_unavailable`: RD-side rot, observed for the owner too even when the
 *   torrent still reads downloaded. Held keys showed no age decay in the
 *   2026-11-05 measurements; retention once nobody holds a torrent is unknown.
 * - `unavailable_file`: the content is unavailable.
 *
 * Other failures must not trigger rot cleanup. `/unrestrict/link` carries its
 * own tight, undocumented throttle that answers `too_many_requests` (error 34)
 * after only a handful of calls seconds apart, as when Stremio resolves several
 * streams at once. A 5xx alone does not establish rot: measured dead links can
 * return `hoster_unavailable` with HTTP 503, but other 5xx failures say nothing
 * about whether the content is still available.
 *
 * A 401 or 403 is never rot, whatever its body names. Real-Debrid documents 403
 * as "account locked, not premium" and sends its refusal of an address the
 * same way, so both are about the caller. The cleanup deletes the link for
 * every member, and one member's lapsed account must not do that.
 */
const PERMANENT_LINK_ERRORS = new Set(['hoster_unavailable', 'unavailable_file']);
const CALLER_STATUSES = new Set([401, 403]);

export const rdErrorOf = (error: unknown): string | null => {
	if (error instanceof AxiosError) {
		const data = error.response?.data as { error?: string } | undefined;
		return data?.error ?? null;
	}
	return null;
};

export const isDeadRdLink = (error: unknown): boolean => {
	if (!(error instanceof AxiosError)) return false;
	if (CALLER_STATUSES.has(error.response?.status ?? 0)) return false;
	const code = rdErrorOf(error);
	return code !== null && PERMANENT_LINK_ERRORS.has(code);
};

/**
 * How long a stored RD link is offered for.
 *
 * This 30-day offering policy is retained, not a measured provider expiry.
 * Held keys showed no age decay; retention without any holder is unknown.
 * Changing this cutoff is a separate policy decision.
 */
export const RD_LINK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const rdLinkCutoff = () => new Date(Date.now() - RD_LINK_MAX_AGE_MS);
