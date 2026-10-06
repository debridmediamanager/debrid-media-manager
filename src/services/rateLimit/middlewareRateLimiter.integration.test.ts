import fixture from '@/test/fixtures/stremioStreamRateLimit/npm-access-log.json';
import torznabTraffic from '@/test/fixtures/torznabRateLimit/zurg-acquisition-2026-10-06.json';
import { castStreamRequest, parseNpmAccessLine } from '@/test/utils/npmAccessLog';
import Redis from 'ioredis';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
	extractIdentifier,
	getRateLimitConfig,
	HybridRateLimiter,
	RATE_LIMIT_CONFIGS,
	RedisRateLimiter,
} from './middlewareRateLimiter';

let dockerAvailable = false;
try {
	const { getContainerRuntimeClient } = await import('testcontainers');
	await getContainerRuntimeClient();
	dockerAvailable = true;
} catch {
	dockerAvailable = false;
}

describe.skipIf(!dockerAvailable)('Redis Rate Limiter Integration Tests', () => {
	let container: StartedTestContainer;
	let redisUrl: string;
	let redis: Redis;

	beforeAll(async () => {
		// Start Redis container
		container = await new GenericContainer('redis:7-alpine')
			.withExposedPorts(6379)
			.withStartupTimeout(60000)
			.start();

		const host = container.getHost();
		const port = container.getMappedPort(6379);
		redisUrl = `redis://${host}:${port}`;

		redis = new Redis(redisUrl);
	}, 120000);

	afterAll(async () => {
		if (redis) {
			await redis.quit();
		}
		if (container) {
			await container.stop();
		}
	});

	describe('RedisRateLimiter', () => {
		const testConfig = { rateLimit: 5, windowSeconds: 60 };

		it('should allow requests under the limit', async () => {
			const limiter = new RedisRateLimiter(redis);

			const result1 = await limiter.check('redis-user1', testConfig);
			expect(result1.success).toBe(true);
			expect(result1.remaining).toBe(4);
			expect(result1.limit).toBe(5);

			const result2 = await limiter.check('redis-user1', testConfig);
			expect(result2.success).toBe(true);
			expect(result2.remaining).toBe(3);
		});

		it('should block requests over the limit', async () => {
			const limiter = new RedisRateLimiter(redis);
			const config = { rateLimit: 3, windowSeconds: 60 };

			// Use up all requests
			for (let i = 0; i < 3; i++) {
				await limiter.check('redis-user2', config);
			}

			const result = await limiter.check('redis-user2', config);
			expect(result.success).toBe(false);
			expect(result.remaining).toBe(0);
		});

		it('should track different users independently', async () => {
			const limiter = new RedisRateLimiter(redis);
			const config = { rateLimit: 2, windowSeconds: 60 };

			// Use up all requests for user3
			await limiter.check('redis-user3', config);
			await limiter.check('redis-user3', config);
			expect((await limiter.check('redis-user3', config)).success).toBe(false);

			// user4 should still be allowed
			const result = await limiter.check('redis-user4', config);
			expect(result.success).toBe(true);
		});

		it('should track different configs independently', async () => {
			const limiter = new RedisRateLimiter(redis);
			const streamConfig = RATE_LIMIT_CONFIGS.stream;
			const defaultConfig = RATE_LIMIT_CONFIGS.default;

			// Use up stream limit (1 req)
			await limiter.check('redis-user5', streamConfig);
			expect((await limiter.check('redis-user5', streamConfig)).success).toBe(false);

			// Default should still work (different window)
			const result = await limiter.check('redis-user5', defaultConfig);
			expect(result.success).toBe(true);
		});

		it('should include reset timestamp', async () => {
			const limiter = new RedisRateLimiter(redis);
			const before = Date.now();

			const result = await limiter.check('redis-user6', testConfig);

			expect(result.reset).toBeGreaterThanOrEqual(before);
			expect(result.reset).toBeLessThanOrEqual(Date.now() + 61000);
		});

		it('should give same-window configs separate keys', async () => {
			const limiter = new RedisRateLimiter(redis);

			// torrents and sponsor are both 1-per-2s, and zurg used to be a third.
			// Keying on the window alone gave the three of them one shared 1-per-2s
			// budget, so a movie page that fetched sponsor status and then searched
			// 429'd on the search.
			expect((await limiter.check('redis-buckets', RATE_LIMIT_CONFIGS.sponsor)).success).toBe(
				true
			);
			expect(
				(await limiter.check('redis-buckets', RATE_LIMIT_CONFIGS.torrents)).success
			).toBe(true);
			expect((await limiter.check('redis-buckets', RATE_LIMIT_CONFIGS.zurg)).success).toBe(
				true
			);

			const keys = await redis.keys('ratelimit:redis-buckets:*');
			expect(keys.sort()).toEqual([
				'ratelimit:redis-buckets:sponsor',
				'ratelimit:redis-buckets:torrents',
				'ratelimit:redis-buckets:zurg',
			]);
		});

		it('should not count a refused request when countRefused is false', async () => {
			const limiter = new RedisRateLimiter(redis);
			const config = {
				rateLimit: 2,
				windowSeconds: 60,
				name: 'uncounted',
				countRefused: false,
			};

			expect((await limiter.check('redis-uncounted', config)).success).toBe(true);
			expect((await limiter.check('redis-uncounted', config)).success).toBe(true);
			for (let i = 0; i < 5; i++) {
				expect((await limiter.check('redis-uncounted', config)).success).toBe(false);
			}

			// Only the two admitted requests hold the window: counting the refusals
			// would keep a busy caller locked out long after those two expire.
			expect(await redis.zcard('ratelimit:redis-uncounted:uncounted')).toBe(2);
		});

		it('should handle concurrent requests correctly', async () => {
			const limiter = new RedisRateLimiter(redis);
			const config = { rateLimit: 10, windowSeconds: 60 };

			// Fire 15 concurrent requests
			const promises = Array.from({ length: 15 }, () =>
				limiter.check('redis-concurrent', config)
			);
			const results = await Promise.all(promises);

			const successCount = results.filter((r) => r.success).length;
			const failedCount = results.filter((r) => !r.success).length;

			expect(successCount).toBe(10);
			expect(failedCount).toBe(5);
		});
	});

	describe('HybridRateLimiter', () => {
		const testConfig = { rateLimit: 5, windowSeconds: 60 };

		it('should use Redis when available', async () => {
			const limiter = new HybridRateLimiter(redisUrl);

			const result = await limiter.check('hybrid-user1', testConfig);
			expect(result.success).toBe(true);

			// Verify it's using Redis by checking the key exists
			const keys = await redis.keys('ratelimit:hybrid-user1:*');
			expect(keys.length).toBe(1);

			await limiter.disconnect();
		});

		it('should fall back to in-memory when Redis URL is not provided', async () => {
			const limiter = new HybridRateLimiter(undefined);

			const result = await limiter.check('hybrid-user2', testConfig);
			expect(result.success).toBe(true);
			expect(result.remaining).toBe(4);

			// Verify no Redis keys were created
			const keys = await redis.keys('ratelimit:hybrid-user2:*');
			expect(keys.length).toBe(0);

			await limiter.disconnect();
		});

		it('should report Redis availability when connected', async () => {
			const limiter = new HybridRateLimiter(redisUrl);
			await limiter.check('test-redis-available', testConfig);
			expect(limiter.isRedisAvailable()).toBe(true);
			await limiter.disconnect();
		});

		it('should enforce rate limits across multiple checks', async () => {
			const limiter = new HybridRateLimiter(redisUrl);
			const config = { rateLimit: 3, windowSeconds: 60 };

			const results = [];
			for (let i = 0; i < 5; i++) {
				results.push(await limiter.check('hybrid-user3', config));
			}

			expect(results[0].success).toBe(true);
			expect(results[1].success).toBe(true);
			expect(results[2].success).toBe(true);
			expect(results[3].success).toBe(false);
			expect(results[4].success).toBe(false);

			await limiter.disconnect();
		});

		it('should handle stream vs default configs separately', async () => {
			const limiter = new HybridRateLimiter(redisUrl);

			// Use up stream limit
			await limiter.check('hybrid-user4', RATE_LIMIT_CONFIGS.stream);
			expect((await limiter.check('hybrid-user4', RATE_LIMIT_CONFIGS.stream)).success).toBe(
				false
			);

			// Default should still work
			const result = await limiter.check('hybrid-user4', RATE_LIMIT_CONFIGS.default);
			expect(result.success).toBe(true);

			await limiter.disconnect();
		});
	});

	describe('Redis Sliding Window Behavior', () => {
		it('should use sliding window algorithm', async () => {
			const limiter = new RedisRateLimiter(redis);
			const config = { rateLimit: 5, windowSeconds: 2 };
			const userId = 'sliding-window-user';

			// Make 5 requests
			for (let i = 0; i < 5; i++) {
				await limiter.check(userId, config);
			}

			// Should be blocked
			expect((await limiter.check(userId, config)).success).toBe(false);

			// Wait for window to expire
			await new Promise((resolve) => setTimeout(resolve, 2500));

			// Should be allowed again
			const result = await limiter.check(userId, config);
			expect(result.success).toBe(true);
		}, 10000);
	});

	describe('Torrents Rate Limiting', () => {
		it('should enforce torrents rate limit config (1 req / 2 sec)', async () => {
			const limiter = new RedisRateLimiter(redis);
			const torrentsConfig = RATE_LIMIT_CONFIGS.torrents;

			// First request should succeed
			const result1 = await limiter.check('torrents-ip-1.2.3.4', torrentsConfig);
			expect(result1.success).toBe(true);
			expect(result1.remaining).toBe(0); // 1 - 1 = 0

			// Second request should be blocked
			const result2 = await limiter.check('torrents-ip-1.2.3.4', torrentsConfig);
			expect(result2.success).toBe(false);
			expect(result2.remaining).toBe(0);
		});

		it('should track different IPs independently for torrents', async () => {
			const limiter = new RedisRateLimiter(redis);
			const torrentsConfig = RATE_LIMIT_CONFIGS.torrents;

			// IP 1 uses up limit
			await limiter.check('torrents-ip-5.6.7.8', torrentsConfig);
			expect((await limiter.check('torrents-ip-5.6.7.8', torrentsConfig)).success).toBe(
				false
			);

			// IP 2 should still work
			const result = await limiter.check('torrents-ip-9.10.11.12', torrentsConfig);
			expect(result.success).toBe(true);
		});

		it('should allow torrents request after window expires', async () => {
			const limiter = new RedisRateLimiter(redis);
			const torrentsConfig = RATE_LIMIT_CONFIGS.torrents;
			const ipAddress = 'torrents-window-test-ip';

			// Use up the limit
			await limiter.check(ipAddress, torrentsConfig);
			expect((await limiter.check(ipAddress, torrentsConfig)).success).toBe(false);

			// Wait for window to expire (2 seconds + buffer)
			await new Promise((resolve) => setTimeout(resolve, 2500));

			// Should be allowed again
			const result = await limiter.check(ipAddress, torrentsConfig);
			expect(result.success).toBe(true);
		}, 10000);

		it('should track torrents and stream configs separately for same identifier', async () => {
			const limiter = new HybridRateLimiter(redisUrl);
			const identifier = 'hybrid-torrents-stream-user';

			// Use up torrents limit
			await limiter.check(identifier, RATE_LIMIT_CONFIGS.torrents);
			expect((await limiter.check(identifier, RATE_LIMIT_CONFIGS.torrents)).success).toBe(
				false
			);

			// Stream should still work (different bucket)
			const streamResult = await limiter.check(identifier, RATE_LIMIT_CONFIGS.stream);
			expect(streamResult.success).toBe(true);

			// Default should also still work
			const defaultResult = await limiter.check(identifier, RATE_LIMIT_CONFIGS.default);
			expect(defaultResult.success).toBe(true);

			await limiter.disconnect();
		});
	});

	// One sponsor's zurg acquisition queue and Prowlarr on 2026-10-06, 13:00-15:00
	// UTC. The key sent about 21 searches a minute against a budget of 20, and
	// zurg asks a refused search again once Retry-After has passed. While the
	// refusals held slots in the window, every retry kept the key at the limit
	// and only 1,597 of the 2,495 arrivals were served, about 13 a minute.
	describe('Torznab search budget, replayed from the access log', () => {
		const requests = torznabTraffic.requests as [string, number][];
		const { rateLimit, windowSeconds } = RATE_LIMIT_CONFIGS.torznabSearch;

		// What a sliding window that holds only served requests admits, worked
		// out here rather than by the limiter under test.
		function servedByBudget(): number[] {
			const served: number[] = [];
			for (const [at] of requests) {
				const now = Date.parse(at) / 1000;
				const held = served.filter((t) => t > now - windowSeconds).length;
				if (held < rateLimit) served.push(now);
			}
			return served;
		}

		it('serves a key that retries refused searches its whole budget', async () => {
			const limiter = new RedisRateLimiter(redis);
			vi.useFakeTimers({ toFake: ['Date'] });
			const served: number[] = [];
			try {
				for (const [at] of requests) {
					vi.setSystemTime(new Date(at));
					const { success } = await limiter.check(
						'sponsor:replay',
						RATE_LIMIT_CONFIGS.torznabSearch
					);
					if (success) served.push(Date.parse(at) / 1000);
				}
			} finally {
				vi.useRealTimers();
			}

			expect(served).toEqual(servedByBudget());
			// Still a budget: no window of a minute served more than it allows.
			for (const t of served) {
				expect(
					served.filter((u) => u > t - windowSeconds && u <= t).length
				).toBeLessThanOrEqual(rateLimit);
			}
			expect(served.length).toBeGreaterThan(
				requests.filter(([, status]) => status === 200).length
			);
		}, 120000);
	});

	// Card 203 on the backend production runs: the sliding window that also
	// counts refusals. Same recordings as src/test/api/stremioStreamRateLimit.test.ts.
	describe('DMM Cast stream budget, replayed from the access log', () => {
		it.each(fixture.sequences.map((s) => [s.name, s] as const))(
			'%s',
			async (_name, sequence) => {
				const limiter = new RedisRateLimiter(redis);
				vi.useFakeTimers({ toFake: ['Date'] });
				try {
					const outcomes: string[] = [];
					for (const line of sequence.lines) {
						const logged = parseNpmAccessLine(line);
						if (!castStreamRequest(logged.path)) continue;
						vi.setSystemTime(logged.at);
						const { success } = await limiter.check(
							extractIdentifier(logged.path, logged.clientIp, null, null),
							getRateLimitConfig(logged.path)
						);
						outcomes.push(success ? 'served' : 'refused');
					}
					expect(outcomes).toEqual(sequence.expect);
				} finally {
					vi.useRealTimers();
				}
			}
		);
	});
});
