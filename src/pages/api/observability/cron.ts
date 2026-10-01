import type { NextApiRequest, NextApiResponse } from 'next';

import { runHealthCheckNow } from '@/lib/observability/streamServersHealth';
import { runTorrentioHealthCheckNow } from '@/lib/observability/torrentioHealth';
import {
	reconcileContentRequests,
	type RequestReconcileResult,
} from '@/services/contentRequestReconcile';
import { reconcileDebridTransfers, type ReconcileResult } from '@/services/debridTransferReconcile';
import { repository } from '@/services/repository';
import { deliverFreeRequests } from '@/services/requestDelivery';

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
	dailyRollup?: {
		streamDailyRolled: boolean;
		rdDailyRolled: boolean;
		torrentioDailyRolled: boolean;
		torboxApiDailyRolled: boolean;
		torboxCdnDailyRolled: boolean;
	};
	debridTransfers?: ReconcileResult;
	contentRequests?: RequestReconcileResult;
	freeRequestDeliveries?: { delivered: number; skipped: number };
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
		// Run the Real-Debrid and Torrentio health checks in parallel. They touch
		// unrelated upstreams, so a slow one never delays the other. TorBox is
		// absent on purpose: it is measured from real user traffic instead of a
		// probe of our own (see getTorBoxObservabilityStats).
		const [streamMetrics] = await Promise.all([
			runHealthCheckNow(),
			runTorrentioHealthCheckNow(),
		]);

		// Roll up yesterday's hourly data into daily aggregates (idempotent)
		let dailyRollup: CronResponse['dailyRollup'];
		try {
			const rollup = await repository.runDailyRollup();
			// TorBox keeps its own tables, so it rolls up alongside rather than
			// inside the Real-Debrid aggregation service.
			const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
			const torboxApiDailyRolled = await repository.rollupTorBoxOperationalDaily(yesterday);
			// Reader-submitted CDN counters roll up the same way.
			const torboxCdnDailyRolled = await repository.rollupTorBoxCdnDaily(yesterday);
			dailyRollup = { ...rollup, torboxApiDailyRolled, torboxCdnDailyRolled };
		} catch (e) {
			console.error('[Cron] Daily rollup failed:', e);
		}

		// Not observability, but this is the only scheduler DMM has, and the
		// alternative — a second crontab line on dmm-01 — is an ops step that
		// ships separately from the code and is forgotten exactly once. A tick
		// that throws must not take the health checks with it.
		let debridTransfers: ReconcileResult | undefined;
		try {
			debridTransfers = await reconcileDebridTransfers();
		} catch (e) {
			console.error('[Cron] Debrid transfer reconciliation failed:', e);
		}

		// Requests are only settled once their transfer has ended, and nothing
		// else is watching them: a fulfiller moves on the moment they click.
		let contentRequests: RequestReconcileResult | undefined;
		try {
			contentRequests = await reconcileContentRequests();
		} catch (e) {
			console.error('[Cron] Content request reconciliation failed:', e);
		}

		// Open requests whose release has reached Real-Debrid since they were
		// filed need no fulfiller, only an add on the asker's account.
		let freeRequestDeliveries: CronResponse['freeRequestDeliveries'];
		try {
			freeRequestDeliveries = await deliverFreeRequests();
		} catch (e) {
			console.error('[Cron] Free request delivery failed:', e);
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
			dailyRollup,
			debridTransfers,
			contentRequests,
			freeRequestDeliveries,
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
