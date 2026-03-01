import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	extractIdentifier,
	getClientIp,
	getRateLimitConfig,
	InMemoryRateLimiter,
	RATE_LIMIT_CONFIGS,
	shouldRateLimit,
} from './middlewareRateLimiter';

describe('middlewareRateLimiter', () => {
	describe('shouldRateLimit', () => {
		it('should return true for /api/stremio paths', () => {
			expect(shouldRateLimit('/api/stremio/abc123456789/catalog/movie')).toBe(true);
			expect(shouldRateLimit('/api/stremio-tb/xyz789012345/catalog/series')).toBe(true);
			expect(shouldRateLimit('/api/stremio-ad/def456789012/meta/movie')).toBe(true);
			expect(shouldRateLimit('/api/stremio/id')).toBe(true);
		});

		it('should return true for /api/torrents paths', () => {
			expect(shouldRateLimit('/api/torrents')).toBe(true);
			expect(shouldRateLimit('/api/torrents/search')).toBe(true);
			expect(shouldRateLimit('/api/torrents/123/download')).toBe(true);
		});

		it('should return false for non-stremio and non-torrents paths', () => {
			expect(shouldRateLimit('/api/healthz')).toBe(false);
			expect(shouldRateLimit('/api/search')).toBe(false);
			expect(shouldRateLimit('/')).toBe(false);
			expect(shouldRateLimit('/browse')).toBe(false);
		});
	});

	describe('getRateLimitConfig', () => {
		it('should return stream config for stream endpoints', () => {
			const config = getRateLimitConfig('/api/stremio/6xPzgFqT0tKI/stream/movie/tt1234567');
			expect(config).toEqual(RATE_LIMIT_CONFIGS.stream);
			expect(config.rateLimit).toBe(1);
			expect(config.windowSeconds).toBe(5);
		});

		it('should return stream config for stremio-tb stream endpoints', () => {
			const config = getRateLimitConfig(
				'/api/stremio-tb/ZNxmirFYKwK0/stream/series/tt1234567'
			);
			expect(config).toEqual(RATE_LIMIT_CONFIGS.stream);
		});

		it('should return stream config for stremio-ad stream endpoints', () => {
			const config = getRateLimitConfig(
				'/api/stremio-ad/OYDJaDP0l5yM/stream/movie/tt1234567'
			);
			expect(config).toEqual(RATE_LIMIT_CONFIGS.stream);
		});

		it('should return default config for catalog endpoints', () => {
			const config = getRateLimitConfig(
				'/api/stremio/6xPzgFqT0tKI/catalog/movie/casted-movies.json'
			);
			expect(config).toEqual(RATE_LIMIT_CONFIGS.default);
			expect(config.rateLimit).toBe(5);
			expect(config.windowSeconds).toBe(1);
		});

		it('should return default config for meta endpoints', () => {
			const config = getRateLimitConfig('/api/stremio/6xPzgFqT0tKI/meta/movie/tt1234567');
			expect(config).toEqual(RATE_LIMIT_CONFIGS.default);
		});

		it('should return default config for other endpoints', () => {
			expect(getRateLimitConfig('/api/stremio/id')).toEqual(RATE_LIMIT_CONFIGS.default);
			expect(getRateLimitConfig('/api/stremio/cast/movie/tt123')).toEqual(
				RATE_LIMIT_CONFIGS.default
			);
			expect(getRateLimitConfig('/api/stremio/links')).toEqual(RATE_LIMIT_CONFIGS.default);
		});

		it('should return torrents config for /api/torrents paths', () => {
			const config = getRateLimitConfig('/api/torrents');
			expect(config).toEqual(RATE_LIMIT_CONFIGS.torrents);
			expect(config.rateLimit).toBe(1);
			expect(config.windowSeconds).toBe(2);
		});

		it('should return torrents config for /api/torrents subpaths', () => {
			expect(getRateLimitConfig('/api/torrents/search')).toEqual(RATE_LIMIT_CONFIGS.torrents);
			expect(getRateLimitConfig('/api/torrents/123/download')).toEqual(
				RATE_LIMIT_CONFIGS.torrents
			);
			expect(getRateLimitConfig('/api/torrents/list?page=1')).toEqual(
				RATE_LIMIT_CONFIGS.torrents
			);
		});
	});

	describe('getClientIp', () => {
		it('should prefer cf-connecting-ip over x-real-ip and x-forwarded-for', () => {
			expect(getClientIp('1.1.1.1', '2.2.2.2', '3.3.3.3')).toBe('1.1.1.1');
		});

		it('should prefer x-real-ip over x-forwarded-for', () => {
			expect(getClientIp(null, '1.2.3.4', '5.6.7.8')).toBe('1.2.3.4');
		});

		it('should use x-forwarded-for when cf-connecting-ip and x-real-ip are null', () => {
			expect(getClientIp(null, null, '5.6.7.8')).toBe('5.6.7.8');
		});

		it('should extract first IP from x-forwarded-for chain', () => {
			expect(getClientIp(null, null, '1.2.3.4, 5.6.7.8, 9.10.11.12')).toBe('1.2.3.4');
		});

		it('should trim whitespace from IPs', () => {
			expect(getClientIp('  1.2.3.4  ', null, null)).toBe('1.2.3.4');
			expect(getClientIp(null, '  2.2.2.2  ', null)).toBe('2.2.2.2');
			expect(getClientIp(null, null, '  5.6.7.8  ')).toBe('5.6.7.8');
		});

		it('should return unknown for null/empty IPs', () => {
			expect(getClientIp(null, null, null)).toBe('unknown');
			expect(getClientIp('', '', '')).toBe('unknown');
			expect(getClientIp('   ', '   ', '   ')).toBe('unknown');
		});

		it('should handle IPv6 addresses', () => {
			expect(getClientIp('2001:0db8:85a3::8a2e:0370:7334', null, null)).toBe(
				'2001:0db8:85a3::8a2e:0370:7334'
			);
		});
	});

	describe('extractIdentifier', () => {
		it('should extract user ID from stremio path', () => {
			// User IDs are 12 characters
			expect(
				extractIdentifier('/api/stremio/6xPzgFqT0tKI/catalog/movie', null, null, null)
			).toBe('6xPzgFqT0tKI');
			expect(
				extractIdentifier('/api/stremio/abcdef123456/meta/movie/tt123', null, null, null)
			).toBe('abcdef123456');
		});

		it('should extract user ID from stremio-tb path', () => {
			expect(
				extractIdentifier('/api/stremio-tb/ZNxmirFYKwK0/catalog/series', null, null, null)
			).toBe('ZNxmirFYKwK0');
		});

		it('should extract user ID from stremio-ad path', () => {
			expect(
				extractIdentifier('/api/stremio-ad/OYDJaDP0l5yM/catalog/movie', null, null, null)
			).toBe('OYDJaDP0l5yM');
		});

		it('should fall back to IP when no user ID in path', () => {
			// Uses x-real-ip first
			expect(extractIdentifier('/api/stremio/id', null, '192.168.1.1', null)).toBe(
				'192.168.1.1'
			);
			// Uses x-forwarded-for when x-real-ip is null
			expect(
				extractIdentifier('/api/stremio/cast/movie', null, null, '10.0.0.1, 192.168.1.1')
			).toBe('10.0.0.1');
		});

		it('should return "unknown" when no user ID and no IP', () => {
			expect(extractIdentifier('/api/stremio/id', null, null, null)).toBe('unknown');
			expect(extractIdentifier('/api/stremio/cast/movie', null, null, null)).toBe('unknown');
		});

		it('should always use IP for /api/torrents paths', () => {
			expect(extractIdentifier('/api/torrents/search', null, '1.2.3.4', null)).toBe(
				'1.2.3.4'
			);
			expect(extractIdentifier('/api/torrents/123', null, null, '5.6.7.8')).toBe('5.6.7.8');
			expect(extractIdentifier('/api/torrents', null, '1.2.3.4', '5.6.7.8')).toBe('1.2.3.4');
		});

		it('should return unknown for /api/torrents when no IP available', () => {
			expect(extractIdentifier('/api/torrents/search', null, null, null)).toBe('unknown');
		});
	});

	describe('InMemoryRateLimiter', () => {
		let limiter: InMemoryRateLimiter;
		const testConfig = { rateLimit: 5, windowSeconds: 60 };

		beforeEach(() => {
			limiter = new InMemoryRateLimiter();
		});

		afterEach(() => {
			limiter.clear();
		});

		it('should allow requests under the limit', () => {
			const result1 = limiter.check('user1', testConfig);
			expect(result1.success).toBe(true);
			expect(result1.remaining).toBe(4);
			expect(result1.limit).toBe(5);

			const result2 = limiter.check('user1', testConfig);
			expect(result2.success).toBe(true);
			expect(result2.remaining).toBe(3);
		});

		it('should block requests over the limit', () => {
			// Use up all requests
			for (let i = 0; i < 5; i++) {
				limiter.check('user1', testConfig);
			}

			const result = limiter.check('user1', testConfig);
			expect(result.success).toBe(false);
			expect(result.remaining).toBe(0);
		});

		it('should track different users independently', () => {
			// Use up all requests for user1
			for (let i = 0; i < 5; i++) {
				limiter.check('user1', testConfig);
			}

			// user2 should still be allowed
			const result = limiter.check('user2', testConfig);
			expect(result.success).toBe(true);
			expect(result.remaining).toBe(4);
		});

		it('should track different rate limit configs independently', () => {
			const streamConfig = RATE_LIMIT_CONFIGS.stream; // 1 req per 5s
			const defaultConfig = RATE_LIMIT_CONFIGS.default; // 5 req per 1s

			// Use up stream limit
			limiter.check('user1', streamConfig);
			expect(limiter.check('user1', streamConfig).success).toBe(false);

			// Default should still work
			const result = limiter.check('user1', defaultConfig);
			expect(result.success).toBe(true);
			expect(result.remaining).toBe(4);
		});

		it('should reset after window expires', () => {
			vi.useFakeTimers();

			// Use up all requests
			for (let i = 0; i < 5; i++) {
				limiter.check('user1', testConfig);
			}

			expect(limiter.check('user1', testConfig).success).toBe(false);

			// Advance time past the window
			vi.advanceTimersByTime(61000);

			const result = limiter.check('user1', testConfig);
			expect(result.success).toBe(true);
			expect(result.remaining).toBe(4);

			vi.useRealTimers();
		});

		it('should include reset timestamp in response', () => {
			const before = Date.now();
			const result = limiter.check('user1', testConfig);
			const after = Date.now();

			expect(result.reset).toBeGreaterThanOrEqual(before + 60000);
			expect(result.reset).toBeLessThanOrEqual(after + 60000);
		});

		it('should cleanup old entries', () => {
			vi.useFakeTimers();

			limiter.check('user1', testConfig);
			limiter.check('user2', testConfig);
			expect(limiter.size()).toBe(2);

			// Advance time past the window
			vi.advanceTimersByTime(61000);

			limiter.cleanup();
			expect(limiter.size()).toBe(0);

			vi.useRealTimers();
		});
	});

	describe('Rate Limit Constants', () => {
		it('should have correct stream config', () => {
			expect(RATE_LIMIT_CONFIGS.stream.rateLimit).toBe(1);
			expect(RATE_LIMIT_CONFIGS.stream.windowSeconds).toBe(5);
		});

		it('should have correct torrents config', () => {
			expect(RATE_LIMIT_CONFIGS.torrents.rateLimit).toBe(1);
			expect(RATE_LIMIT_CONFIGS.torrents.windowSeconds).toBe(2);
		});

		it('should have correct default config', () => {
			expect(RATE_LIMIT_CONFIGS.default.rateLimit).toBe(5);
			expect(RATE_LIMIT_CONFIGS.default.windowSeconds).toBe(1);
		});
	});

	describe('Edge Cases', () => {
		describe('extractIdentifier edge cases', () => {
			it('should handle paths with special characters after user ID', () => {
				expect(
					extractIdentifier(
						'/api/stremio/abcdef123456/stream/movie/tt:1234567.json',
						null,
						null,
						null
					)
				).toBe('abcdef123456');
			});

			it('should handle very long user IDs', () => {
				const longId = 'a'.repeat(50);
				expect(
					extractIdentifier(`/api/stremio/${longId}/catalog/movie`, null, null, null)
				).toBe(longId);
			});

			it('should handle user IDs with only numbers', () => {
				expect(
					extractIdentifier('/api/stremio/123456789012/catalog/movie', null, null, null)
				).toBe('123456789012');
			});

			it('should handle user IDs with only letters', () => {
				expect(
					extractIdentifier('/api/stremio/abcdefghijkl/catalog/movie', null, null, null)
				).toBe('abcdefghijkl');
			});

			it('should handle IPv6 addresses as fallback', () => {
				expect(
					extractIdentifier(
						'/api/stremio/id',
						null,
						'2001:0db8:85a3:0000:0000:8a2e:0370:7334',
						null
					)
				).toBe('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
			});

			it('should handle empty string IP', () => {
				expect(extractIdentifier('/api/stremio/id', '', '', '')).toBe('unknown');
			});

			it('should handle whitespace-only IP', () => {
				expect(extractIdentifier('/api/stremio/id', '   ', '   ', '   ')).toBe('unknown');
			});

			it('should use x-real-ip for torrents even when x-forwarded-for available', () => {
				expect(
					extractIdentifier('/api/torrents/download', null, '1.2.3.4', '5.6.7.8')
				).toBe('1.2.3.4');
			});
		});

		describe('getRateLimitConfig edge cases', () => {
			it('should handle stream path with query parameters', () => {
				const config = getRateLimitConfig(
					'/api/stremio/6xPzgFqT0tKI/stream/movie/tt1234567?quality=1080p'
				);
				expect(config).toEqual(RATE_LIMIT_CONFIGS.stream);
			});

			it('should handle nested stream paths', () => {
				const config = getRateLimitConfig(
					'/api/stremio/6xPzgFqT0tKI/stream/series/tt1234567/1/1'
				);
				expect(config).toEqual(RATE_LIMIT_CONFIGS.stream);
			});

			it('should not match partial stream in path', () => {
				// "streaming" should not match "stream/"
				const config = getRateLimitConfig('/api/stremio/6xPzgFqT0tKI/streaming/movie');
				expect(config).toEqual(RATE_LIMIT_CONFIGS.default);
			});

			it('should handle manifest.json paths', () => {
				const config = getRateLimitConfig('/api/stremio/6xPzgFqT0tKI/manifest.json');
				expect(config).toEqual(RATE_LIMIT_CONFIGS.default);
			});
		});

		describe('shouldRateLimit edge cases', () => {
			it('should match stremio with trailing content', () => {
				expect(shouldRateLimit('/api/stremio-something-else')).toBe(true);
			});

			it('should not match partial stremio prefix', () => {
				expect(shouldRateLimit('/api/stremi')).toBe(false);
			});

			it('should match exact /api/stremio', () => {
				expect(shouldRateLimit('/api/stremio')).toBe(true);
			});

			it('should match exact /api/torrents', () => {
				expect(shouldRateLimit('/api/torrents')).toBe(true);
			});

			it('should match torrents with trailing content', () => {
				expect(shouldRateLimit('/api/torrents/search?q=test')).toBe(true);
			});

			it('should not match partial torrents prefix', () => {
				expect(shouldRateLimit('/api/torrent')).toBe(false);
			});
		});

		describe('InMemoryRateLimiter edge cases', () => {
			let limiter: InMemoryRateLimiter;

			beforeEach(() => {
				limiter = new InMemoryRateLimiter();
			});

			afterEach(() => {
				limiter.clear();
			});

			it('should handle rapid successive requests', () => {
				const config = { rateLimit: 100, windowSeconds: 1 };
				const results = [];

				for (let i = 0; i < 150; i++) {
					results.push(limiter.check('rapid-user', config));
				}

				const successCount = results.filter((r) => r.success).length;
				expect(successCount).toBe(100);
			});

			it('should handle multiple users with different configs simultaneously', () => {
				const streamConfig = RATE_LIMIT_CONFIGS.stream;
				const defaultConfig = RATE_LIMIT_CONFIGS.default;

				// User 1 uses stream config
				limiter.check('user1', streamConfig);
				expect(limiter.check('user1', streamConfig).success).toBe(false);

				// User 2 uses default config
				for (let i = 0; i < 5; i++) {
					expect(limiter.check('user2', defaultConfig).success).toBe(true);
				}
				expect(limiter.check('user2', defaultConfig).success).toBe(false);

				// User 1 with default config should still work
				expect(limiter.check('user1', defaultConfig).success).toBe(true);
			});

			it('should correctly report remaining count', () => {
				const config = { rateLimit: 3, windowSeconds: 60 };

				expect(limiter.check('user', config).remaining).toBe(2);
				expect(limiter.check('user', config).remaining).toBe(1);
				expect(limiter.check('user', config).remaining).toBe(0);
				expect(limiter.check('user', config).remaining).toBe(0); // Still 0 after limit
			});

			it('should handle rate limit of 1', () => {
				const config = { rateLimit: 1, windowSeconds: 60 };
				const result1 = limiter.check('user', config);
				expect(result1.success).toBe(true);
				expect(result1.remaining).toBe(0);

				const result2 = limiter.check('user', config);
				expect(result2.success).toBe(false);
				expect(result2.remaining).toBe(0);
			});

			it('should handle very short window', () => {
				vi.useFakeTimers();
				const config = { rateLimit: 1, windowSeconds: 1 };

				expect(limiter.check('user', config).success).toBe(true);
				expect(limiter.check('user', config).success).toBe(false);

				vi.advanceTimersByTime(1001);

				expect(limiter.check('user', config).success).toBe(true);

				vi.useRealTimers();
			});
		});
	});
});
