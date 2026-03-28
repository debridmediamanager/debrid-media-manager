import { TrackerStatsService } from '@/services/database/trackerStats';
import { torrentScraper } from '@/utils/torrentScraper';
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

		if (hashes.length > 10) {
			return res.status(400).json({ error: 'Maximum 10 hashes allowed per refresh request' });
		}

		// Validate each hash
		const invalidHashes = hashes.filter(
			(hash) => typeof hash !== 'string' || !isValidTorrentHash(hash)
		);
		if (invalidHashes.length > 0) {
			return res.status(400).json({
				error: 'Invalid hash format(s). All hashes must be 40 hexadecimal characters.',
				invalidHashes,
			});
		}

		const trackerStatsService = new TrackerStatsService();
		const results = [];

		// Scrape and store fresh stats for each hash
		for (const hash of hashes) {
			try {
				// Scrape fresh tracker stats
				const scrapedStats = await torrentScraper.scrapeTorrent(hash);

				// Store in database
				await trackerStatsService.upsertTrackerStats({
					hash,
					seeders: scrapedStats.seeders,
					leechers: scrapedStats.leechers,
					downloads: scrapedStats.downloads,
					successfulTrackers: scrapedStats.successfulTrackers,
					totalTrackers: scrapedStats.totalTrackers,
				});

				// Add to results
				results.push({
					hash,
					seeders: scrapedStats.seeders,
					leechers: scrapedStats.leechers,
					downloads: scrapedStats.downloads,
					successfulTrackers: scrapedStats.successfulTrackers,
					totalTrackers: scrapedStats.totalTrackers,
					lastChecked: new Date().toISOString(),
				});
			} catch (error) {
				console.error(`Failed to refresh stats for hash ${hash}:`, error);
				// Add error result
				results.push({
					hash,
					error: 'Failed to scrape tracker stats',
					seeders: 0,
					leechers: 0,
					downloads: 0,
					successfulTrackers: 0,
					totalTrackers: 0,
					lastChecked: new Date().toISOString(),
				});
			}
		}

		return res.status(200).json(results);
	} catch (error) {
		console.error('Error refreshing tracker stats:', error);
		return res.status(500).json({
			error: 'Failed to refresh tracker stats',
			message: error instanceof Error ? error.message : 'Unknown error',
		});
	}
};

export default handler;
