import { describe, expect, it, vi } from 'vitest';

import { RATE_LIMIT_CONFIGS, rateLimitBucket } from '@/services/rateLimit/middlewareRateLimiter';

// A wrapped handler does not expose the config it was built with, so stand in
// for the wrapper and record what each route asks for. See snapshotRateLimit.
const seen: Record<string, string | undefined> = {};
let current = '';

vi.mock('@/services/rateLimit/withRateLimit', async () => {
	const actual = await vi.importActual<
		typeof import('@/services/rateLimit/middlewareRateLimiter')
	>('@/services/rateLimit/middlewareRateLimiter');
	return {
		RATE_LIMIT_CONFIGS: actual.RATE_LIMIT_CONFIGS,
		withRateLimit: (handler: unknown) => handler,
		withCustomRateLimit: (handler: unknown) => handler,
		withIpRateLimit: (handler: unknown, config: { name?: string }) => {
			seen[current] = config?.name;
			return handler;
		},
	};
});

// Both routes answer by asking the community addon and kitsu.io, and neither
// had a limit, so any client could drive those upstreams through dmm-01.
describe('anime metadata rate limit', () => {
	it.each([['@/pages/api/info/anime'], ['@/pages/api/search/anime']])(
		'%s draws from the anime budget',
		async (route) => {
			vi.resetModules();
			current = route;
			await import(/* @vite-ignore */ route);
			expect(seen[route]).toBe('anime');
		}
	);

	it('does not share a counter with the challenge endpoint', () => {
		expect(rateLimitBucket(RATE_LIMIT_CONFIGS.anime)).not.toBe(
			rateLimitBucket(RATE_LIMIT_CONFIGS.default)
		);
	});
});
