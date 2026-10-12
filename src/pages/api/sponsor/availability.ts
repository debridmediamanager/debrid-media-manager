import { validateDmmApiKeyHeader } from '@/pages/api/zurg/auth';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import type { NextApiRequest, NextApiResponse } from 'next';

const MAX_HASHES = 100;
const INFO_HASH = /^[a-f0-9]{40}$/;
const IMDB_ID = /^tt\d+$/;

/**
 * Which hashes DMM has itself seen cached on Real-Debrid (Available) or AllDebrid
 * (AvailableAd), with their files: what /api/availability/check, check2 and their
 * ad/ twins answer the site behind a problem token, for a sponsor's own tools
 * behind their DMM API key. `imdbId` scopes the answer to that title.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	if (!(await validateDmmApiKeyHeader(req, res))) return;

	const { service, imdbId, hashes } = (req.body ?? {}) as {
		service?: unknown;
		imdbId?: unknown;
		hashes?: unknown;
	};
	if (service !== 'rd' && service !== 'ad') {
		return res.status(400).json({ error: 'Service must be rd or ad' });
	}
	if (imdbId !== undefined && (typeof imdbId !== 'string' || !IMDB_ID.test(imdbId))) {
		return res.status(400).json({ error: 'Invalid IMDb ID' });
	}
	const wanted = Array.isArray(hashes)
		? hashes.map((h) => (typeof h === 'string' ? h.toLowerCase() : ''))
		: [];
	if (!wanted.length || wanted.length > MAX_HASHES || !wanted.every((h) => INFO_HASH.test(h))) {
		return res.status(400).json({
			error: `Expected {"service": "rd"|"ad", "hashes": [...], "imdbId"?: "tt..."} with 1-${MAX_HASHES} 40-character info hashes`,
		});
	}

	try {
		const available =
			service === 'rd'
				? imdbId
					? await db.checkAvailability(imdbId, wanted)
					: await db.checkAvailabilityByHashes(wanted)
				: imdbId
					? await db.checkAvailabilityAd(imdbId, wanted)
					: await db.checkAvailabilityAdByHashes(wanted);
		return res.status(200).json({ available });
	} catch (error) {
		console.error('Error checking sponsor availability:', error);
		return res.status(500).json({ error: 'Failed to check available hashes' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.sponsorAvailability);
