import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { getBlocklist, hasLoadedBlocklist } from '@/services/takedown/blocklist';
import { NextApiHandler } from 'next';

// What approved notices removed, for the uploaders and scrapers that never
// read DMM's database. Hashes and normalized release names only: no titles,
// no claimants.
const handler: NextApiHandler = async (req, res) => {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const list = await getBlocklist();
	// The consumers keep their last good copy through an error, but would
	// replace it with an empty one answered as a success.
	if (!hasLoadedBlocklist()) {
		return res.status(503).json({ error: 'Blocklist unavailable' });
	}
	const etag = `"${list.version}"`;
	res.setHeader('ETag', etag);
	res.setHeader('Cache-Control', 'public, max-age=60');
	if (req.headers['if-none-match'] === etag) return res.status(304).end();
	return res.status(200).json({
		version: list.version,
		hashes: [...list.hashes],
		releases: [...list.releases],
	});
};

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.takedownBlocklist);
