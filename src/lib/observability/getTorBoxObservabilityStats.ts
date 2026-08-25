import type { TorBoxOverallStats } from '@/services/database/torboxOperational';
import { repository } from '@/services/repository';

/**
 * How far back the user-traffic window reaches, in whole hours.
 *
 * Counters are bucketed by hour, and `getStats(n)` keeps buckets whose start is
 * within the last n hours - so a 1-hour window collapses to "the current bucket
 * only", which at :01 past the hour is a minute of traffic. The page verdict
 * rides on this number now, so the window is 2 hours: always one complete
 * bucket plus the partial current one, never a near-empty sample.
 */
export const USER_TRAFFIC_WINDOW_HOURS = 2;

export interface TorBoxObservabilityStats {
	/**
	 * What TorBox actually returned to DMM users over the window, counted from
	 * their own API calls. DMM issues no requests of its own to TorBox - a
	 * synthetic probe measures one datacentre IP's rate-limit standing, not the
	 * service, and TorBox 429s it often enough to read as a false outage.
	 * Null only if the query itself failed.
	 */
	tbApi: TorBoxOverallStats | null;
	/** Hours covered by `tbApi`, so the page can label its own window. */
	windowHours: number;
	/**
	 * Start of the most recent hour bucket that has rows, in epoch millis.
	 * Null when no TorBox traffic has been recorded in the window at all.
	 */
	lastChecked: number | null;
}

/**
 * Assembles the TorBox status payload purely from recorded user traffic.
 */
export async function getTorBoxObservabilityStats(): Promise<TorBoxObservabilityStats> {
	const tbApi = await repository.getTorBoxOperationalStats(USER_TRAFFIC_WINDOW_HOURS);

	return {
		tbApi,
		windowHours: USER_TRAFFIC_WINDOW_HOURS,
		lastChecked: tbApi?.lastHour ? new Date(tbApi.lastHour).getTime() : null,
	};
}
