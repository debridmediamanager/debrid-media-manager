import { HybridRateLimiter } from '@/services/rateLimit/middlewareRateLimiter';

// The counters DMM paces itself against an upstream with: searches per indexer
// in search.ts, grabs per indexer in the grab handler. Its own limiter instance
// rather than `checkRateLimitFor`: that one writes the X-RateLimit-* headers,
// which belong to the caller's own budget. These counters must never appear in
// a client's response.
let upstreamLimiter: HybridRateLimiter | null = null;

export function getUpstreamLimiter(): HybridRateLimiter {
	if (!upstreamLimiter) upstreamLimiter = new HybridRateLimiter(process.env.REDIS_URL);
	return upstreamLimiter;
}

/** Test-only: the limiter is a module singleton and its counters outlive a test. */
export function _resetUpstreamLimiterForTest(): void {
	upstreamLimiter = null;
}
