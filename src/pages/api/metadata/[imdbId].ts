import { getMetadata } from '@/services/metadata';
import { hasInternalSecret } from '@/utils/internalAuth';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * The canonical metadata record for an IMDb id — a movie, a show with its
 * seasons, or an episode naming its series — merged from TMDB, Trakt, mdblist,
 * Cinemeta, OMDb and TVmaze. For DMM's own services (the uploaders, zurg, the
 * scrapers); callers authenticate with `METADATA_API_SECRET`.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	if (!hasInternalSecret(req, process.env.METADATA_API_SECRET)) {
		return res.status(401).json({ error: 'Unauthorized' });
	}

	const imdbId = typeof req.query.imdbId === 'string' ? req.query.imdbId : '';
	if (!/^tt\d{7,}$/.test(imdbId)) {
		return res.status(400).json({ error: 'A valid IMDb id is required' });
	}

	try {
		const record = await getMetadata(imdbId);
		res.setHeader('Cache-Control', 'private, no-store');
		if (!record) return res.status(404).json({ error: 'Unknown IMDb id' });
		return res.status(200).json(record);
	} catch (error) {
		console.error(`[metadata] ${imdbId} failed`, error);
		return res.status(500).json({ error: 'Metadata lookup failed' });
	}
}
