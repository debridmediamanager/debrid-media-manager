import { fetchWithRetry } from './fetchWithRetry';

// Helper function to batch arrays into chunks
function batchArray<T>(array: T[], batchSize: number): T[][] {
	const batches: T[][] = [];
	for (let i = 0; i < array.length; i += batchSize) {
		batches.push(array.slice(i, i + batchSize));
	}
	return batches;
}

export async function getMultipleTrackerStats(hashes: string[], imdbId: string): Promise<any[]> {
	try {
		// Batch hashes into groups of 100
		const batches = batchArray(hashes, 100);
		const allResults: any[] = [];

		// Process each batch
		for (const batch of batches) {
			const response = await fetchWithRetry('/api/torrents/stats/bulk', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ hashes: batch, imdbId }),
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.error || 'Failed to get bulk tracker stats');
			}

			const batchResults = await response.json();
			allResults.push(...batchResults);
		}

		return allResults;
	} catch (error) {
		console.error('Error getting bulk tracker stats:', error);
		throw error;
	}
}

// Helper function to determine if tracker stats should be included based on user settings
export function shouldIncludeTrackerStats(): boolean {
	if (typeof window === 'undefined') return false;
	return window.localStorage.getItem('settings:includeTrackerStats') === 'true';
}

// Helper function to get tracker stats with caching (used only during availability checks)
export async function getCachedTrackerStats(
	hash: string,
	maxAgeHours: number = 24,
	forceRefresh: boolean = false
): Promise<any | null> {
	try {
		// First, try to get stored stats
		const storedResponse = await fetchWithRetry(`/api/torrents/stats/stored?hash=${hash}`, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
			},
		});

		let stored: any | null = null;
		if (storedResponse.ok) {
			stored = await storedResponse.json();
		}

		if (stored && !forceRefresh) {
			const lastChecked = new Date(stored.lastChecked);
			const now = new Date();
			const ageHours = (now.getTime() - lastChecked.getTime()) / (1000 * 60 * 60);

			// For dead torrents (0 seeders), use shorter cache time (1 hour)
			// This allows checking if dead torrents have come back to life
			const effectiveMaxAge = stored.seeders === 0 ? 1 : maxAgeHours;

			// If stats are fresh enough, return them
			if (ageHours < effectiveMaxAge) {
				return stored;
			}
		}

		// If no stored stats, they're stale, or force refresh is requested, fetch fresh ones
		// This should only be called during availability checks when the setting is enabled
		const freshResponse = await fetchWithRetry(`/api/torrents/stats?hash=${hash}`, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
			},
		});

		if (!freshResponse.ok) {
			const error = await freshResponse.json();
			throw new Error(error.error || 'Failed to fetch tracker stats');
		}

		const fresh = await freshResponse.json();
		return {
			hash: fresh.hash,
			seeders: fresh.seeders,
			leechers: fresh.leechers,
			downloads: fresh.downloads,
			successfulTrackers: fresh.trackers.successful,
			totalTrackers: fresh.trackers.total,
			lastChecked: new Date().toISOString(),
		};
	} catch (error) {
		console.error(`Error getting cached tracker stats for ${hash}:`, error);
		return null;
	}
}
