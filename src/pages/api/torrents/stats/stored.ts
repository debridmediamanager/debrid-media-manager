import { TrackerStatsService } from '@/services/database/trackerStats';
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
		const { hash } = req.query;

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

		// Get stored tracker stats
		let stats = null;
		try {
			const trackerStatsService = new TrackerStatsService();
			stats = await trackerStatsService.getTrackerStats(hash);
		} catch (dbError: any) {
			// If database is not available or table doesn't exist, return 404
			if (dbError?.message?.includes('does not exist') || dbError?.code === 'P2021') {
				return res.status(404).json({
					error: 'Tracker stats feature not available',
					reason: 'Database table not initialized',
				});
			}
			throw dbError;
		}

		if (!stats) {
			return res.status(404).json({ error: 'No tracker stats found for this hash' });
		}

		// Return the stats
		return res.status(200).json({
			hash: stats.hash,
			seeders: stats.seeders,
			leechers: stats.leechers,
			downloads: stats.downloads,
			successfulTrackers: stats.successfulTrackers,
			totalTrackers: stats.totalTrackers,
			lastChecked: stats.lastChecked.toISOString(),
		});
	} catch (error) {
		console.error('Error getting stored tracker stats:', error);
		return res.status(500).json({
			error: 'Failed to get stored tracker stats',
			message: error instanceof Error ? error.message : 'Unknown error',
		});
	}
};

export default handler;
