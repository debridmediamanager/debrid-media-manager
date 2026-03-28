import { TrackerStatsService } from '@/services/database/trackerStats';
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

		// Validate authentication - TEMPORARILY DISABLED
		// if (
		// 	!dmmProblemKey ||
		// 	!(typeof dmmProblemKey === 'string') ||
		// 	!solution ||
		// 	!(typeof solution === 'string')
		// ) {
		// 	res.status(403).json({ errorMessage: 'Authentication not provided' });
		// 	return;
		// } else if (!(await validateTokenWithHash(dmmProblemKey.toString(), solution.toString()))) {
		// 	res.status(403).json({ errorMessage: 'Authentication error' });
		// 	return;
		// }

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
