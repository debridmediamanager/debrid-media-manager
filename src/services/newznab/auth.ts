// Sponsor gate for the Newznab aggregation endpoint.
//
// Same resolution as the zurg endpoints — `Sponsors.dmmApiKey`, never the
// `DmmApiKeys` table, so a lapsed sponsorship and a key reset both take effect
// (see pages/api/zurg/auth.ts for why) — but it answers in Newznab's protocol
// instead of JSON, so nothing is written to the response here. The caller turns
// the code into an `<error/>` document, because *arr clients read that document
// and several treat a non-200 as an unreachable indexer without looking at it.

import type { SponsorLookup } from '@/services/database';
import { repository as db } from '@/services/repository';
import type { NextApiRequest } from 'next';

/**
 * Newznab's own credential codes: 100 is bad credentials, 101 is an account
 * that exists but is not entitled. Split on purpose, exactly as the zurg gate
 * splits them — the key is a 64-char sha256 digest so there is no enumeration
 * to protect against, and a sponsor whose sponsorship lapsed otherwise sees
 * "incorrect credentials" and re-copies the same working key forever.
 */
export const NEWZNAB_BAD_CREDENTIALS = 100;
export const NEWZNAB_LAPSED_SPONSORSHIP = 101;

export const NEWZNAB_AUTH_MESSAGES: Record<100 | 101, string> = {
	100: 'Incorrect user credentials',
	101: 'Your sponsorship is no longer active',
};

export type NewznabAuthResult = { sponsor: SponsorLookup } | { errorCode: 100 | 101 };

/**
 * The DMM API key the caller presented.
 *
 * `apikey` first because that is where every Newznab client puts it — Prowlarr,
 * Sonarr and Radarr all build the query string and none of them can be told to
 * send a header. The header is the fallback for a person testing with curl.
 *
 * Exported so the search handler can put the *caller's* key into the enclosure
 * URLs it emits without re-deriving the precedence rule: a grab has to arrive
 * authenticated, and a client that authenticated by header still follows an
 * enclosure URL as a plain GET.
 */
export function newznabApiKey(req: NextApiRequest): string {
	const fromQuery = req.query.apikey;
	if (typeof fromQuery === 'string' && fromQuery.trim()) return fromQuery.trim();

	const fromHeader = req.headers['x-api-key'];
	if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim();

	return '';
}

/**
 * Resolves the sponsorship behind a request, or the Newznab error code to
 * answer with. Never writes to the response.
 */
export async function resolveNewznabSponsor(req: NextApiRequest): Promise<NewznabAuthResult> {
	const apiKey = newznabApiKey(req);
	// `getSponsorByDmmApiKey` validates the digest shape itself and answers null
	// for anything else, so a missing key and a malformed one land together.
	if (!apiKey) return { errorCode: NEWZNAB_BAD_CREDENTIALS };

	const sponsor = await db.getSponsorByDmmApiKey(apiKey);
	if (!sponsor) return { errorCode: NEWZNAB_BAD_CREDENTIALS };
	if (!sponsor.isSponsor) return { errorCode: NEWZNAB_LAPSED_SPONSORSHIP };

	return { sponsor };
}
