import { describe, expect, it, vi } from 'vitest';

import {
	InMemoryRateLimiter,
	RATE_LIMIT_CONFIGS,
	rateLimitBucket,
} from '@/services/rateLimit/middlewareRateLimiter';

// A wrapped handler does not expose the config it was built with, so stand in
// for the wrapper and record what the route asks for. See zurgRateLimit.test.ts.
const seen: { name?: string } = {};

vi.mock('@/services/rateLimit/withRateLimit', async () => {
	const actual = await vi.importActual<
		typeof import('@/services/rateLimit/middlewareRateLimiter')
	>('@/services/rateLimit/middlewareRateLimiter');
	return {
		RATE_LIMIT_CONFIGS: actual.RATE_LIMIT_CONFIGS,
		withRateLimit: (handler: unknown) => handler,
		withCustomRateLimit: (handler: unknown) => handler,
		withIpRateLimit: (handler: unknown, config: { name?: string }) => {
			seen.name = config?.name;
			return handler;
		},
	};
});

describe('hash-imdb rate limit', () => {
	it('draws from its own budget', async () => {
		vi.resetModules();
		seen.name = undefined;
		await import('@/pages/api/torrents/hash-imdb');
		expect(seen.name).toBe('hashImdb');
		expect(rateLimitBucket(RATE_LIMIT_CONFIGS.hashImdb)).not.toBe(
			rateLimitBucket(RATE_LIMIT_CONFIGS.torrents)
		);
	});

	it('takes the largest burst one zurg was seen sending', () => {
		// dmm-01's proxy log, 2026-09-27..10-03: 68 zurgs, 20,035 posts, 15,343
		// refused 429 on `torrents`. One address sent 82 inside two seconds and
		// 95 inside ten: zurg posts every 100-pair chunk back to back.
		const limiter = new InMemoryRateLimiter();
		for (let i = 0; i < 95; i++) {
			expect(limiter.check('203.0.113.7', RATE_LIMIT_CONFIGS.hashImdb).success).toBe(true);
		}
	});
});
