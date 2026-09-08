import { describe, expect, it, vi } from 'vitest';

import { RATE_LIMIT_CONFIGS, rateLimitBucket } from '@/services/rateLimit/middlewareRateLimiter';

// A wrapped handler does not expose the config it was built with, so stand in
// for the wrapper and record what each route asks for. setup.ts mocks this
// module too; a file-level mock replaces it for this file only.
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

describe('zurg rate limit config', () => {
	it('is a minute-long budget, matching the Newznab and Torznab indexers', () => {
		// These are the three machine-facing search surfaces. A client that fans
		// out over several titles at once has to fit in one budget rather than be
		// refused on its second call, so all three are sized per minute.
		for (const config of [
			RATE_LIMIT_CONFIGS.zurg,
			RATE_LIMIT_CONFIGS.newznabSearch,
			RATE_LIMIT_CONFIGS.torznabSearch,
		]) {
			expect(config.rateLimit).toBe(20);
			expect(config.windowSeconds).toBe(60);
		}
	});

	it('is a different bucket from the website torrents budget', () => {
		// Buckets are keyed on the config name, so a zurg route that names
		// `torrents` spends the website's own search counter.
		expect(rateLimitBucket(RATE_LIMIT_CONFIGS.zurg)).not.toBe(
			rateLimitBucket(RATE_LIMIT_CONFIGS.torrents)
		);
	});
});

describe('zurg routes draw from the zurg budget', () => {
	// search-torrents drew from `torrents` until 2026-09-08, which put it on one
	// 1-per-2s counter with /api/torrents/movie, /api/torrents/tv and zurg's own
	// hash-imdb ingestion: a sponsor's zurg and their browser refused each other
	// from the same IP.
	it.each([
		['search-torrents', () => import('@/pages/api/zurg/search-torrents')],
		['hashes-by-imdb', () => import('@/pages/api/zurg/hashes-by-imdb')],
		['show-info', () => import('@/pages/api/zurg/show-info')],
		['resolve-tmdb', () => import('@/pages/api/zurg/resolve-tmdb')],
	])('%s', async (_name, load) => {
		vi.resetModules();
		seen.name = undefined;
		await load();
		expect(seen.name).toBe('zurg');
	});
});
