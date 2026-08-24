// Thin wrapper around the repository for recording TorBox API operations.
// Provides fire-and-forget functions for use in torbox.ts and anticors.ts.

import { repository } from '@/services/repository';

export type {
	TorBoxOperation,
	TorBoxOperationStats,
	TorBoxOverallStats,
} from '@/services/database/torboxOperational';

export { resolveTorBoxOperation } from '@/services/database/torboxOperational';

/**
 * Records a TorBox API operation event.
 * This is a fire-and-forget operation - errors are logged but not thrown.
 * Only runs on server-side (not in browser).
 */
export function recordTorBoxOperationEvent(
	operation: Parameters<typeof repository.recordTorBoxOperation>[0],
	status: number
): void {
	// Only record on server-side
	if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
		return;
	}

	// Fire-and-forget
	repository.recordTorBoxOperation(operation, status).catch((error) => {
		console.error('Failed to record TorBox operation:', error);
	});
}

/**
 * Gets TorBox API stats for the last N hours.
 */
export function getTorBoxOperationalStats(hoursBack?: number) {
	return repository.getTorBoxOperationalStats(hoursBack);
}

/**
 * Gets hourly history for charts.
 */
export function getTorBoxOperationalHourlyHistory(hoursBack?: number) {
	return repository.getTorBoxOperationalHourlyHistory(hoursBack);
}
