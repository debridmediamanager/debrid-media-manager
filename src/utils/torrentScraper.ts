import Client from 'bittorrent-tracker';
import { trackerManager } from './trackerManager';

interface TrackerResult {
	complete: number; // seeders
	incomplete: number; // leechers
	downloaded: number; // total downloads
}

interface TorrentStats {
	seeders: number;
	leechers: number;
	downloads: number;
	successfulTrackers: number;
	totalTrackers: number;
}

class TorrentScraper {
	private async scrapeTracker(
		infoHash: Buffer,
		announceUrl: string,
		timeout: number = 10000
	): Promise<TrackerResult | null> {
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				resolve(null);
			}, timeout);

			// Use the static scrape method which is simpler and more reliable
			Client.scrape(
				{
					announce: announceUrl,
					infoHash,
				},
				(err: Error | null, data?: any) => {
					clearTimeout(timer);

					if (err) {
						// Don't log every error as there will be many failures
						resolve(null);
						return;
					}

					if (data) {
						resolve({
							complete: data.complete || 0,
							incomplete: data.incomplete || 0,
							downloaded: data.downloaded || 0,
						});
					} else {
						resolve(null);
					}
				}
			);
		});
	}

	async scrapeTorrent(infoHash: string): Promise<TorrentStats> {
		// Validate info hash format (40 hex characters)
		if (!/^[a-fA-F0-9]{40}$/i.test(infoHash)) {
			throw new Error('Invalid info hash format. Must be 40 hexadecimal characters.');
		}

		// Get current tracker list
		const trackers = await trackerManager.getTrackers();
		// UDP scrape packets require the 20 hash bytes, not the 40-character hex
		// spelling. Reuse the same decoded hash across every tracker protocol.
		const hashBytes = Buffer.from(infoHash, 'hex');

		// Scrape all trackers in parallel
		const scrapePromises = trackers.map((tracker) => this.scrapeTracker(hashBytes, tracker));

		const results = await Promise.all(scrapePromises);

		// Aggregate results
		let totalSeeders = 0;
		let totalLeechers = 0;
		let totalDownloads = 0;
		let successfulTrackers = 0;

		for (const result of results) {
			if (result) {
				// Take the maximum values since different trackers may have different counts
				// We don't sum them as they might be counting the same peers
				totalSeeders = Math.max(totalSeeders, result.complete);
				totalLeechers = Math.max(totalLeechers, result.incomplete);
				totalDownloads = Math.max(totalDownloads, result.downloaded);
				successfulTrackers++;
			}
		}

		return {
			seeders: totalSeeders,
			leechers: totalLeechers,
			downloads: totalDownloads,
			successfulTrackers,
			totalTrackers: trackers.length,
		};
	}
}

// Export singleton instance
export const torrentScraper = new TorrentScraper();
