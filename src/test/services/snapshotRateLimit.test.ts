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

describe('torrent snapshot rate limit', () => {
	it('draws from its own budget', async () => {
		vi.resetModules();
		seen.name = undefined;
		await import('@/pages/api/torrents/snapshot');
		expect(seen.name).toBe('snapshot');
		// On `torrents` a snapshot burst also refused zurg's hash-imdb calls.
		expect(rateLimitBucket(RATE_LIMIT_CONFIGS.snapshot)).not.toBe(
			rateLimitBucket(RATE_LIMIT_CONFIGS.torrents)
		);
	});

	it('takes the largest burst one zurg was seen sending', () => {
		// dmm-01's proxy log, 2026-09-07..10: 82 snapshot posts from one address
		// inside two seconds.
		const limiter = new InMemoryRateLimiter();
		for (let i = 0; i < 82; i++) {
			expect(limiter.check('203.0.113.7', RATE_LIMIT_CONFIGS.snapshot).success).toBe(true);
		}
	});
});
