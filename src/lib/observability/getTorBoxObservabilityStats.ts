import type { TorBoxAuthState } from '@/services/database/torboxHealth';
import { repository } from '@/services/repository';

import { fetchServiceStats, isTorBoxHealthCheckInProgress } from './torboxHealth';

export interface TorBoxCdnNodeSummary {
	host: string;
	region: string;
	name: string;
	latencyMs: number | null;
	ok: boolean;
	error: string | null;
}

export interface TorBoxCdnMetricsSummary {
	total: number;
	working: number;
	rate: number;
	lastChecked: number | null;
	avgLatencyMs: number | null;
	fastestNode: string | null;
	nodes: TorBoxCdnNodeSummary[];
	inProgress: boolean;
}

export interface TorBoxApiCheckSummary {
	apiOk: boolean;
	apiLatencyMs: number | null;
	apiDetail: string | null;
	authState: TorBoxAuthState;
	authError: string | null;
	totalNodes: number;
	workingNodes: number;
	checkedAt: number;
}

export interface TorBoxApiSummary {
	ok: boolean | null;
	latencyMs: number | null;
	detail: string | null;
	successCount: number;
	totalCount: number;
	successRate: number | null;
	recentChecks: TorBoxApiCheckSummary[];
}

export interface TorBoxAuthSummary {
	state: TorBoxAuthState;
	error: string | null;
}

export interface TorBoxServiceSummary {
	totalUsers: number | null;
	totalServers: number | null;
}

export interface TorBoxObservabilityStats {
	cdn: TorBoxCdnMetricsSummary;
	api: TorBoxApiSummary;
	auth: TorBoxAuthSummary;
	service: TorBoxServiceSummary | null;
	/**
	 * When the stored data was last refreshed by the cron, in epoch millis.
	 * The page renders this rather than its own fetch time, so a stalled cron
	 * shows as stale instead of silently looking fresh.
	 */
	lastChecked: number | null;
}

const RECENT_CHECK_LIMIT = 12;

/**
 * Assembles the TorBox status payload from stored check results.
 *
 * The public `/v1/api/stats` call is the one live request made per page load -
 * it is unauthenticated, cheap, and purely contextual, so a failure degrades to
 * `null` rather than failing the response.
 */
export async function getTorBoxObservabilityStats(): Promise<TorBoxObservabilityStats> {
	const [cdnMetrics, cdnStatuses, recentChecks, service] = await Promise.all([
		repository.getTorBoxCdnMetrics(),
		repository.getAllTorBoxCdnStatuses(),
		repository.getRecentTorBoxChecks(RECENT_CHECK_LIMIT),
		fetchServiceStats().catch(() => null),
	]);

	const nodes: TorBoxCdnNodeSummary[] = cdnStatuses
		.map((status) => ({
			host: status.host,
			region: status.region,
			name: status.name,
			latencyMs: status.latencyMs,
			ok: status.ok,
			error: status.error,
		}))
		.sort((a, b) => {
			if (a.ok !== b.ok) return a.ok ? -1 : 1;
			return (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity);
		});

	const apiChecks: TorBoxApiCheckSummary[] = recentChecks.map((check) => ({
		apiOk: check.apiOk,
		apiLatencyMs: check.apiLatencyMs,
		apiDetail: check.apiDetail,
		authState: check.authState,
		authError: check.authError,
		totalNodes: check.totalNodes,
		workingNodes: check.workingNodes,
		checkedAt: check.checkedAt.getTime(),
	}));

	const latest = apiChecks[0] ?? null;
	const apiSuccessCount = apiChecks.filter((c) => c.apiOk).length;

	// The freshest of the two clocks: a check row is written on every run, even
	// one where node discovery failed and the CDN table was left untouched.
	const lastChecked = maxOrNull([cdnMetrics.lastChecked, latest?.checkedAt ?? null]);

	return {
		cdn: {
			total: cdnMetrics.total,
			working: cdnMetrics.working,
			rate: cdnMetrics.rate,
			lastChecked: cdnMetrics.lastChecked,
			avgLatencyMs: cdnMetrics.avgLatencyMs,
			fastestNode: cdnMetrics.fastestNode,
			nodes,
			inProgress: isTorBoxHealthCheckInProgress(),
		},
		api: {
			ok: latest ? latest.apiOk : null,
			latencyMs: latest?.apiLatencyMs ?? null,
			detail: latest?.apiDetail ?? null,
			successCount: apiSuccessCount,
			totalCount: apiChecks.length,
			successRate: apiChecks.length > 0 ? apiSuccessCount / apiChecks.length : null,
			recentChecks: apiChecks,
		},
		auth: {
			state: latest?.authState ?? 'skipped',
			error: latest?.authError ?? null,
		},
		service,
		lastChecked,
	};
}

function maxOrNull(values: Array<number | null>): number | null {
	const defined = values.filter((v): v is number => v !== null);
	return defined.length > 0 ? Math.max(...defined) : null;
}
