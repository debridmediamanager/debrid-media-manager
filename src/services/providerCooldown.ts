import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which metadata providers have answered 429, and until when DMM sends them
 * nothing more.
 *
 * Every replica on dmm-01 shares one IP and so one rate-limit bucket at each
 * provider. On 2026-10-07 a zurg restart asked the resolver 620 times in three
 * minutes; Trakt began refusing after about a thousand calls, and DMM went on
 * asking it, collecting 1,614 more 429s, until the burst ended. Each refusal
 * also failed real users' show pages until Trakt's window reset. A refusal now
 * stops every Trakt call in the replica for as long as Trakt asked, and the
 * calls in between are answered from the cache or not at all.
 *
 * Per process, not shared through Redis: a replica that has not heard the 429
 * yet spends one more call to hear it, which is four calls per window at most.
 */

/** When a 429 carries no Retry-After. */
const DEFAULT_COOLDOWN_MS = 60_000;
/** Trakt's edge has asked for 600s; a longer answer is more likely a bad header. */
const MAX_COOLDOWN_MS = 15 * 60_000;

const cooldownUntil = new Map<string, number>();

/**
 * A call DMM did not make, or that the provider refused, because the provider
 * is rate-limiting DMM. Its stack is the message alone: callers log errors
 * whole, and a refusal is one line, not a dump.
 *
 * It is shaped like the error axios throws for a 429, with the remaining wait
 * as Retry-After, because routes such as movie-details, show and related pass
 * a provider's status through to their own caller and answered 429 here before.
 */
export class ProviderCooldownError extends Error {
	readonly isAxiosError = true;
	readonly response: { status: 429; headers: Record<string, string>; data: string };

	constructor(
		readonly host: string,
		readonly retryAfterMs: number
	) {
		super(`${host} is rate-limiting DMM for ${Math.ceil(retryAfterMs / 1000)}s more`);
		this.name = 'ProviderCooldownError';
		this.stack = `${this.name}: ${this.message}`;
		this.response = {
			status: 429,
			headers: { 'retry-after': String(Math.ceil(retryAfterMs / 1000)) },
			data: this.message,
		};
	}
}

/** The host a provider URL is counted against, or the URL itself when it does not parse. */
export function providerHost(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

/** Retry-After in milliseconds, from delta-seconds or an HTTP date; null when absent or unreadable. */
export function parseRetryAfter(value: unknown, now = Date.now()): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value * 1000);
	if (typeof value !== 'string' || !value.trim()) return null;
	const trimmed = value.trim();
	if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
	const at = Date.parse(trimmed);
	return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** How long the host has left to cool down, in milliseconds; 0 when it may be asked. */
export function cooldownRemainingMs(host: string, now = Date.now()): number {
	const until = cooldownUntil.get(host);
	if (until === undefined) return 0;
	if (until <= now) {
		cooldownUntil.delete(host);
		return 0;
	}
	return until - now;
}

/**
 * Starts (or extends) a host's cooldown after a 429. Returns its length and
 * whether it is new, so that the replica's other calls refused in the same
 * moment do not each log it again.
 */
export function startCooldown(
	host: string,
	retryAfter: unknown,
	now = Date.now()
): { ms: number; started: boolean } {
	const asked = parseRetryAfter(retryAfter, now);
	const ms = Math.min(Math.max(asked ?? DEFAULT_COOLDOWN_MS, 1000), MAX_COOLDOWN_MS);
	const started = cooldownRemainingMs(host, now) === 0;
	cooldownUntil.set(host, Math.max(cooldownUntil.get(host) ?? 0, now + ms));
	return { ms, started };
}

/** For tests. */
export function resetProviderCooldowns(): void {
	cooldownUntil.clear();
}

type GapLedger = { retryAfterMs: number };
const gaps = new AsyncLocalStorage<GapLedger>();

/**
 * Records that a lookup came back without data because its provider is
 * cooling down, for whichever `trackProviderGaps` call it runs under.
 */
export function noteProviderGap(retryAfterMs: number): void {
	const ledger = gaps.getStore();
	if (ledger) ledger.retryAfterMs = Math.max(ledger.retryAfterMs, retryAfterMs);
}

/**
 * Runs `work` and reports, beside its result, how long the longest provider
 * cooldown that left it without data has to run (0 when none did). For callers
 * that must not answer from part of the evidence: the resolver, whose callers
 * keep its answer.
 */
export async function trackProviderGaps<T>(
	work: () => Promise<T>
): Promise<{ result: T; retryAfterMs: number }> {
	const ledger: GapLedger = { retryAfterMs: 0 };
	const result = await gaps.run(ledger, work);
	return { result, retryAfterMs: ledger.retryAfterMs };
}

/**
 * A failed provider request as one log line — `HTTP 503 from api.trakt.tv`,
 * `ECONNABORTED timeout of 10000ms exceeded` — or null when the error is not a
 * request failure, whose stack is then worth printing.
 */
export function describeProviderError(error: unknown): string | null {
	if (error instanceof ProviderCooldownError) return error.message;
	if (!error || typeof error !== 'object') return null;
	const record = error as {
		isAxiosError?: boolean;
		code?: unknown;
		message?: unknown;
		response?: { status?: unknown };
		config?: { url?: unknown };
	};
	if (!record.isAxiosError) return null;
	const status = record.response?.status;
	if (typeof status === 'number') {
		const url = typeof record.config?.url === 'string' ? record.config.url : '';
		return url ? `HTTP ${status} from ${providerHost(url)}` : `HTTP ${status}`;
	}
	const code = typeof record.code === 'string' ? `${record.code} ` : '';
	return `${code}${typeof record.message === 'string' ? record.message : 'request failed'}`;
}
