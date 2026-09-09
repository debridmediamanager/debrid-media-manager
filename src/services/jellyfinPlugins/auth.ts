// Sponsor gate for the Jellyfin plugin catalog.
//
// Same resolution as the zurg and Newznab gates — `Sponsors.dmmApiKey`, never
// the `DmmApiKeys` table, so a lapsed sponsorship and a gatekeeper key reset
// both take effect (see `pages/api/zurg/auth.ts` for why).
//
// Every request is resolved against the database. Nothing about a caller is
// cached, and no URL is signed to outlive its key, so revoking a key stops the
// next request rather than the next cache expiry.

import type { SponsorLookup } from '@/services/database';
import { repository as db } from '@/services/repository';
import type { NextApiRequest } from 'next';

export type PluginAuthResult =
	| { sponsor: SponsorLookup; apiKey: string }
	| { status: 401; error: string };

const BAD_CREDENTIALS = 'Invalid API key';

/**
 * Split from "invalid" on purpose, exactly as the sibling gates split it: the
 * key is a 64-character sha256 digest so there is nothing to enumerate, and a
 * sponsor whose sponsorship lapsed otherwise sees a bare "invalid key" and
 * re-copies the same working key forever.
 */
const LAPSED = 'Sponsorship is no longer active';

/**
 * The key a caller presented.
 *
 * A path segment first, because that is the only place Jellyfin can carry one on
 * a download: it decides whether a `sourceUrl` is installable by looking at the
 * end of the URL, so `…/plugin.zip?apikey=…` is refused as "not a zip archive"
 * before any request is made. The query form is what the repository URL itself
 * uses, and the header is for a person testing with curl.
 *
 * @param req The incoming request.
 * @param fromPath A key already parsed out of the route, if the route had one.
 * @returns The key, or an empty string.
 */
export function pluginApiKey(req: NextApiRequest, fromPath?: string): string {
	if (fromPath && fromPath.trim()) return fromPath.trim();

	const fromQuery = req.query.apikey;
	if (typeof fromQuery === 'string' && fromQuery.trim()) return fromQuery.trim();

	const fromHeader = req.headers['x-api-key'];
	if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim();

	return '';
}

/**
 * Resolves the sponsorship behind a request. Never writes to the response.
 *
 * @param req The incoming request.
 * @param fromPath A key already parsed out of the route, if the route had one.
 * @returns The sponsor and the key they used, or the refusal to answer with.
 */
export async function resolvePluginSponsor(
	req: NextApiRequest,
	fromPath?: string
): Promise<PluginAuthResult> {
	const apiKey = pluginApiKey(req, fromPath);
	// `getSponsorByDmmApiKey` validates the digest shape itself and answers null
	// for anything else, so a missing key and a malformed one land together.
	if (!apiKey) return { status: 401, error: BAD_CREDENTIALS };

	const sponsor = await db.getSponsorByDmmApiKey(apiKey);
	if (!sponsor) return { status: 401, error: BAD_CREDENTIALS };
	if (!sponsor.isSponsor) return { status: 401, error: LAPSED };

	return { sponsor, apiKey };
}
