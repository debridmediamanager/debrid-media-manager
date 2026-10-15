import { sponsorOfDmmApiKeyHeader } from '@/pages/api/zurg/auth';
import { getMetadata, getMetadataBundle, parseMetadataId } from '@/services/metadata';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { hasInternalSecret } from '@/utils/internalAuth';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Who may read the metadata API: DMM's own services by `METADATA_API_SECRET`, unmetered,
 * and sponsors by their DMM API key in `x-api-key`, 300 calls a minute per sponsorship
 * wherever their servers run. False once the refusal is sent.
 */
export async function metadataAccess(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
	if (hasInternalSecret(req, process.env.METADATA_API_SECRET)) return true;
	if (!req.headers['x-api-key'] && req.headers.authorization) {
		res.status(401).json({ error: 'Unauthorized' });
		return false;
	}
	const sponsor = await sponsorOfDmmApiKeyHeader(req, res);
	if (!sponsor) return false;
	if (
		!(await checkRateLimitFor(`sponsor:${sponsor.shortId}`, RATE_LIMIT_CONFIGS.metadata, res))
	) {
		res.status(429).json({ error: 'Rate limit exceeded' });
		return false;
	}
	return true;
}

const index = (value: unknown) =>
	typeof value === 'string' && /^\d{1,4}$/.test(value) ? Number(value) : undefined;

/**
 * Everything DMM's sources say about one title: `/api/metadata/imdb:tt0852863`,
 * `/api/metadata/tmdb:tv:1877` or `tmdb:movie:603` answers `{ids, type, merged, sources}`,
 * each provider's own answer under `sources` (TMDB, Trakt, mdblist, Cinemeta, OMDb,
 * TVmaze, TMDB's find) beside DMM's merge of them. `?season=N`, and `&episode=N`, add
 * TMDB's season list and episode; `?sources=tmdb` answers TMDB's records alone.
 *
 * A bare IMDb id (`/api/metadata/tt0852863`) answers the merged record alone, as it
 * always has for DMM's own services.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const raw = typeof req.query.id === 'string' ? req.query.id : '';
	const legacy = /^tt\d{7,}$/.test(raw);
	const id = legacy ? null : parseMetadataId(raw);
	const tmdbOnly = req.query.sources === 'tmdb';
	const season = index(req.query.season);
	const episode = index(req.query.episode);
	if (
		(!legacy && !id) ||
		(req.query.sources !== undefined && !tmdbOnly) ||
		(req.query.season && season === undefined) ||
		(req.query.episode && (episode === undefined || season === undefined))
	) {
		return res.status(400).json({
			error: 'Name the title as imdb:tt…, tmdb:movie:N or tmdb:tv:N; season and episode are numbers, episode with a season; sources is tmdb or absent',
		});
	}
	if (!(await metadataAccess(req, res))) return;

	try {
		res.setHeader('Cache-Control', 'private, no-store');
		if (legacy) {
			const record = await getMetadata(raw);
			if (!record) return res.status(404).json({ error: 'Unknown IMDb id' });
			return res.status(200).json(record);
		}
		const bundle = await getMetadataBundle(id!, { season, episode, tmdbOnly });
		if (!bundle) return res.status(404).json({ error: 'No source knows this title' });
		return res.status(200).json(bundle);
	} catch (error) {
		console.error(`[metadata] ${raw} failed`, error);
		return res.status(500).json({ error: 'Metadata lookup failed' });
	}
}
