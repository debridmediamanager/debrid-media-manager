import { repository as db } from '@/services/repository';
import { hasInternalSecret } from '@/utils/internalAuth';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Whether a Sponsorship ID is still active: `?id=ZP1M` → `{ active: boolean }`.
 *
 * nzb2rd's caller. dmm sends the id with every priority it grants, and nzb2rd
 * asks here again as the job is about to start, because its queue is days deep
 * and the priority tier and sponsor allowance have to end with the sponsorship.
 * An id no sponsor holds is simply not active.
 *
 * Authenticated with `METADATA_API_SECRET`, which nzb2rd already holds for the
 * metadata API (as `DMM_METADATA_SECRET`), so this adds no new secret. A failed
 * lookup answers 503 rather than a verdict: nzb2rd keeps the tier on anything
 * but a definite answer, and a database blip must not read as a lapse.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	if (!hasInternalSecret(req, process.env.METADATA_API_SECRET)) {
		return res.status(401).json({ error: 'Unauthorized' });
	}

	const id = typeof req.query.id === 'string' ? req.query.id : '';
	if (!/^[A-Za-z0-9]{1,32}$/.test(id)) {
		return res.status(400).json({ error: 'id must be a Sponsorship ID' });
	}

	try {
		const sponsor = await db.getSponsorByShortId(id);
		res.setHeader('Cache-Control', 'private, no-store');
		return res.status(200).json({ active: !!sponsor?.isSponsor });
	} catch (error) {
		console.error('Sponsorship lookup for nzb2rd failed:', error);
		return res.status(503).json({ error: 'Could not read the sponsorship right now' });
	}
}
