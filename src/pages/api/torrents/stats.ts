import { TrackerStatsService } from '@/services/database/trackerStats';
import { validateProblemToken } from '@/utils/problemToken';
import { torrentScraper } from '@/utils/torrentScraper';
import { NextApiHandler } from 'next';

function isValidTorrentHash(hash: string): boolean {
	return /^[a-fA-F0-9]{40}$/i.test(hash);
}

const handler: NextApiHandler = async (req, res) => {
	// Only allow GET requests
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	try {
		const { hash, dmmProblemKey, solution } = req.query;

		// This gate was written commented-out in the commit that added the feature
		// (1bf984d4) and never enabled, which left the route open to anyone. That
		// matters more here than on a plain read: a single request fans out to
		// every tracker in ngosang/trackerslist — 109 of them at the time of
		// writing — as parallel outbound connections with a 10s timeout each, then
		// writes a row. Unauthenticated, that is a ~109x amplifier pointed at this
		// server's IP, repeatable at will.
		//
		// A token is not a strong identity (anyone can mint one from
		// /api/challenge), but it takes this off the list of things reachable with
		// a bare curl, and it costs the browser nothing: the client caches a token
		// for two minutes and reuses it across a whole sweep. Deliberately NOT
		// rate-limited — 1de10977 removed rate limiting from the stats endpoints
		// because concurrent page loads were getting 429s, and reinstating it here
		// would repeat that regression.
		if (
			!dmmProblemKey ||
			!(typeof dmmProblemKey === 'string') ||
			!solution ||
			!(typeof solution === 'string')
		) {
			res.status(403).json({ errorMessage: 'Authentication not provided' });
			return;
		} else if (!validateProblemToken(dmmProblemKey, solution)) {
			res.status(403).json({ errorMessage: 'Authentication error' });
			return;
		}

		// Validate hash parameter
		if (!hash || typeof hash !== 'string') {
			return res.status(400).json({ error: 'Missing "hash" query parameter' });
		}

		if (!isValidTorrentHash(hash)) {
			return res.status(400).json({
				error: 'Invalid hash format. Must be 40 hexadecimal characters.',
				hash,
			});
		}

		// Scrape torrent stats
		const stats = await torrentScraper.scrapeTorrent(hash);

		// Store the stats in the database for future use
		try {
			const trackerStatsService = new TrackerStatsService();
			await trackerStatsService.upsertTrackerStats({
				hash: hash.toLowerCase(),
				seeders: stats.seeders,
				leechers: stats.leechers,
				downloads: stats.downloads,
				successfulTrackers: stats.successfulTrackers,
				totalTrackers: stats.totalTrackers,
			});
		} catch (dbError) {
			console.error('Failed to store tracker stats in database:', dbError);
			// Continue with the response even if database storage fails
		}

		// Return the stats
		return res.status(200).json({
			hash: hash.toLowerCase(),
			seeders: stats.seeders,
			leechers: stats.leechers,
			downloads: stats.downloads,
			trackers: {
				successful: stats.successfulTrackers,
				total: stats.totalTrackers,
			},
		});
	} catch (error) {
		console.error('Error getting torrent stats:', error);
		return res.status(500).json({
			error: 'Failed to get torrent stats',
			message: error instanceof Error ? error.message : 'Unknown error',
		});
	}
};

export default handler;
