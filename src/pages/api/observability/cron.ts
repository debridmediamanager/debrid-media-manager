import type { NextApiRequest, NextApiResponse } from 'next';

import { runHealthCheckNow } from '@/lib/observability/streamServersHealth';
import { runTorBoxHealthCheckNow } from '@/lib/observability/torboxHealth';
import { runTorrentioHealthCheckNow } from '@/lib/observability/torrentioHealth';
import { repository } from '@/services/repository';

interface CronResponse {
	success: boolean;
	timestamp: string;
	streamHealth?: {
		working: number;
		total: number;
		rate: number;
		avgLatencyMs: number | null;
	};
	torrentioHealth?: {
		checked: boolean;
	};
	torboxHealth?: {
		checked: boolean;
	};
	dailyRollup?: {
		streamDailyRolled: boolean;
		rdDailyRolled: boolean;
		torrentioDailyRolled: boolean;
		torboxDailyRolled: boolean;
		torboxApiDailyRolled: boolean;
	};
	error?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<CronResponse>) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({
			success: false,
			timestamp: new Date().toISOString(),
			error: 'Method not allowed',
		});
	}

	// Optional secret key protection
	const expectedSecret = process.env.CRON_SECRET;
	const providedSecret = req.query.secret ?? req.headers['x-cron-secret'];
	if (expectedSecret && providedSecret !== expectedSecret) {
		return res.status(401).json({
			success: false,
			timestamp: new Date().toISOString(),
			error: 'Unauthorized',
		});
	}

	try {
		// Run the Real-Debrid, Torrentio and TorBox health checks in parallel.
		// They touch unrelated upstreams, so a slow one never delays the others.
		const [streamMetrics] = await Promise.all([
			runHealthCheckNow(),
			runTorrentioHealthCheckNow(),
			runTorBoxHealthCheckNow(),
		]);

		// Roll up yesterday's hourly data into daily aggregates (idempotent)
		let dailyRollup: CronResponse['dailyRollup'];
		try {
			const rollup = await repository.runDailyRollup();
			// TorBox keeps its own tables, so it rolls up alongside rather than
			// inside the Real-Debrid aggregation service.
			const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
			const torboxDailyRolled = await repository.rollupTorBoxDaily(yesterday);
			const torboxApiDailyRolled = await repository.rollupTorBoxOperationalDaily(yesterday);
			dailyRollup = { ...rollup, torboxDailyRolled, torboxApiDailyRolled };
		} catch (e) {
			console.error('[Cron] Daily rollup failed:', e);
		}

		return res.status(200).json({
			success: true,
			timestamp: new Date().toISOString(),
			streamHealth: streamMetrics
				? {
						working: streamMetrics.working,
						total: streamMetrics.total,
						rate: streamMetrics.rate,
						avgLatencyMs: streamMetrics.avgLatencyMs,
					}
				: undefined,
			torrentioHealth: {
				checked: true,
			},
			torboxHealth: {
				checked: true,
			},
			dailyRollup,
		});
	} catch (error) {
		console.error('[Cron] Job failed:', error);
		return res.status(500).json({
			success: false,
			timestamp: new Date().toISOString(),
			error: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
