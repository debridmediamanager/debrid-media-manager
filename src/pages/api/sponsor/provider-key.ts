import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { ProviderProbeError, validateProviderKey } from '@/services/torznab/providerCache';
import { requireSponsor } from '@/utils/requireSponsor';
import {
	isTorznabLiveService,
	LIVE_SERVICE_LABELS,
	maskProviderKey,
	type TorznabLiveService,
} from '@/utils/sponsorProviders';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * The debrid keys a sponsor links for the Torznab feed's availability filters.
 *
 * Real-Debrid and AllDebrid are absent on purpose: their availability comes from
 * DMM's own tables, so `/api/torznab/rd/cached` works for every sponsor with
 * nothing linked and must never start asking for a credential.
 *
 * The key is kept here rather than carried in the feed URL. An indexer URL sits
 * in plaintext in every *arr's config, is copied into forum posts when something
 * breaks, and arrives in DMM's own access logs in full - all three are places a
 * debrid key must not be.
 *
 * Behind `requireSponsor`, so the signature on the token is checked rather than
 * the badge in localStorage.
 */

export interface LinkedProviderResponse {
	service: TorznabLiveService;
	label: string;
	/** Masked. The stored key is never returned. */
	hint: string;
	updatedAt: string;
}

function bodyService(req: NextApiRequest): TorznabLiveService | null {
	const raw = typeof req.body?.service === 'string' ? req.body.service.trim() : '';
	return isTorznabLiveService(raw) ? raw : null;
}

async function listFor(shortId: string): Promise<LinkedProviderResponse[]> {
	const linked = await db.listSponsorProviderKeys(shortId);
	return linked.map((row) => ({
		service: row.service,
		label: LIVE_SERVICE_LABELS[row.service],
		hint: row.hint,
		updatedAt: row.updatedAt.toISOString(),
	}));
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	const payload = requireSponsor(req, res);
	if (!payload) return;

	if (req.method === 'GET') {
		return res.status(200).json({ linked: await listFor(payload.shortId) });
	}

	if (req.method === 'POST') {
		const service = bodyService(req);
		if (!service) {
			return res.status(400).json({ error: 'Unknown service' });
		}

		const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
		if (!apiKey) {
			return res.status(400).json({ error: 'Missing API key' });
		}

		// Checked against the provider before it is stored, with the same call
		// the feed makes. A key that only fails at search time turns into an
		// empty feed, which reads as "there are no releases" rather than as a
		// typo made in this form.
		try {
			await validateProviderKey(service, apiKey);
		} catch (error) {
			if (error instanceof ProviderProbeError) {
				return res.status(400).json({ error: error.message });
			}
			throw error;
		}

		await db.setSponsorProviderKey(payload.shortId, service, apiKey);
		return res.status(200).json({
			linked: await listFor(payload.shortId),
			hint: maskProviderKey(apiKey),
		});
	}

	if (req.method === 'DELETE') {
		const service = bodyService(req);
		if (!service) {
			return res.status(400).json({ error: 'Unknown service' });
		}
		await db.removeSponsorProviderKey(payload.shortId, service);
		return res.status(200).json({ linked: await listFor(payload.shortId) });
	}

	return res.status(405).json({ error: 'Method not allowed' });
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.sponsor);
