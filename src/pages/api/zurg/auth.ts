import type { SponsorLookup } from '@/services/database/sponsors';
import { repository as db } from '@/services/repository';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Sponsor gate for the zurg endpoints, keyed on the gatekeeper DMM API key.
 *
 * Resolved through `Sponsors.dmmApiKey`, never the `DmmApiKeys` table: that
 * table is a bare list of key strings with no link back to a sponsor and no
 * expiry, so it can say a key was once issued but never that the sponsorship
 * behind it is still live. Validating against it granted these endpoints to
 * every lapsed sponsor forever, and left a key revoked by gatekeeper's Reset
 * API Key button working — the reset mints a new key and bumps the version but
 * leaves the old row in place. Same reasoning as `services/database/sponsors.ts`
 * and `utils/requireSponsor.ts`.
 */
export async function validateDmmApiKeyHeader(
	req: NextApiRequest,
	res: NextApiResponse,
	/** Also accept a sponsor's pre-`dmmApiKey` key, for routes that took those keys. */
	options: { acceptLegacyZurgKey?: boolean } = {}
): Promise<boolean> {
	return (await sponsorOfDmmApiKeyHeader(req, res, options)) !== null;
}

/**
 * `validateDmmApiKeyHeader`, answering the sponsorship itself, for a route that
 * budgets per sponsor rather than per address. Null once the 401 is sent.
 */
export async function sponsorOfDmmApiKeyHeader(
	req: NextApiRequest,
	res: NextApiResponse,
	options: { acceptLegacyZurgKey?: boolean } = {}
): Promise<SponsorLookup | null> {
	const apiKey = req.headers['x-api-key'];
	if (!apiKey || typeof apiKey !== 'string') {
		res.status(401).json({ error: 'Missing x-api-key header' });
		return null;
	}

	const sponsor =
		(await db.getSponsorByDmmApiKey(apiKey)) ??
		(options.acceptLegacyZurgKey ? await db.getSponsorByLegacyZurgKey(apiKey) : null);
	if (!sponsor) {
		res.status(401).json({ error: 'Invalid API key' });
		return null;
	}

	// Split from "invalid" on purpose: the key is a 64-char sha256 digest, so
	// there is no enumeration to protect against, and a sponsor whose GitHub
	// sponsorship lapsed otherwise sees a bare "invalid key" and re-copies the
	// same working key forever.
	if (!sponsor.isSponsor) {
		res.status(401).json({ error: 'Sponsorship is no longer active' });
		return null;
	}

	return sponsor;
}
