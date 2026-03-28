import { TrackerStatsService } from '@/services/database/trackerStats';
import { NextApiHandler } from 'next';

function isValidTorrentHash(hash: string): boolean {
	return /^[a-fA-F0-9]{40}$/i.test(hash);
}

const handler: NextApiHandler = async (req, res) => {
	// Only allow POST requests
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	try {
		const { hashes } = req.body;

		// Validate hashes parameter
		if (!hashes || !Array.isArray(hashes)) {
			return res.status(400).json({ error: 'Missing or invalid "hashes" parameter' });
		}

		if (hashes.length === 0) {
			return res.status(400).json({ error: 'Hashes array cannot be empty' });
		}

		if (hashes.length > 100) {
			return res.status(400).json({ error: 'Maximum 100 hashes allowed per request' });
		}

		// Validate each hash
		const invalidHashes = hashes.filter(
			(hash) => typeof hash !== 'string' || !isValidTorrentHash(hash)
		);
		if (invalidHashes.length > 0) {
			return res.status(400).json({
				error: 'Invalid hash format(s). All hashes must be 40 hexadecimal characters.',
				invalidHashes: invalidHashes.slice(0, 5), // Show first 5 invalid hashes
			});
		}

		// Get stored tracker stats for all hashes
		const trackerStatsService = new TrackerStatsService();
		const stats = await trackerStatsService.getTrackerStatsByHashes(hashes);

		// Format response
		const formattedStats = stats.map((stat) => ({
			hash: stat.hash,
			seeders: stat.seeders,
			leechers: stat.leechers,
			downloads: stat.downloads,
			successfulTrackers: stat.successfulTrackers,
			totalTrackers: stat.totalTrackers,
			lastChecked: stat.lastChecked.toISOString(),
		}));

		return res.status(200).json(formattedStats);
	} catch (error) {
		console.error('Error getting bulk tracker stats:', error);
		return res.status(500).json({
			error: 'Failed to get bulk tracker stats',
			message: error instanceof Error ? error.message : 'Unknown error',
		});
	}
};

export default handler;
