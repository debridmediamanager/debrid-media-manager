import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	extractIdentifier,
	getClientIp,
	getRateLimitConfig,
	InMemoryRateLimiter,
	RATE_LIMIT_CONFIGS,
	shouldRateLimit,
} from './middlewareRateLimiter';

describe('RATE_LIMIT_CONFIGS', () => {
	it('defines stream, torrents, proxy, report, and default configs', () => {
		expect(RATE_LIMIT_CONFIGS.stream).toEqual({ rateLimit: 1, windowSeconds: 5 });
		expect(RATE_LIMIT_CONFIGS.torrents).toEqual({ rateLimit: 1, windowSeconds: 2 });
		expect(RATE_LIMIT_CONFIGS.proxy).toEqual({ rateLimit: 3, windowSeconds: 1 });
		expect(RATE_LIMIT_CONFIGS.report).toEqual({ rateLimit: 5, windowSeconds: 10 });
		expect(RATE_LIMIT_CONFIGS.default).toEqual({ rateLimit: 5, windowSeconds: 1 });
	});
});

describe('getRateLimitConfig', () => {
	it('returns stream config for stremio stream paths', () => {
		expect(getRateLimitConfig('/api/stremio/ABCDEF1234/stream/movie/tt1234567')).toBe(
			RATE_LIMIT_CONFIGS.stream
		);
	});

	it('returns stream config for stremio-tb stream paths', () => {
		expect(getRateLimitConfig('/api/stremio-tb/ABCDEF1234/stream/movie/tt1234567')).toBe(
			RATE_LIMIT_CONFIGS.stream
		);
	});

	it('returns stream config for stremio-ad stream paths', () => {
		expect(getRateLimitConfig('/api/stremio-ad/ABCDEF1234/stream/movie/tt1234567')).toBe(
			RATE_LIMIT_CONFIGS.stream
		);
	});

	it('returns torrents config for torrents paths', () => {
		expect(getRateLimitConfig('/api/torrents/search')).toBe(RATE_LIMIT_CONFIGS.torrents);
	});

	it('returns default config for other paths', () => {
		expect(getRateLimitConfig('/api/some/other/path')).toBe(RATE_LIMIT_CONFIGS.default);
	});
});

describe('getClientIp', () => {
	it('prefers cf-connecting-ip', () => {
		expect(getClientIp('1.2.3.4', '5.6.7.8', '9.10.11.12')).toBe('1.2.3.4');
	});

	it('falls back to x-real-ip', () => {
		expect(getClientIp(null, '5.6.7.8', '9.10.11.12')).toBe('5.6.7.8');
	});

	it('falls back to first x-forwarded-for entry', () => {
		expect(getClientIp(null, null, '9.10.11.12, 13.14.15.16')).toBe('9.10.11.12');
	});

	it('returns unknown when no headers present', () => {
		expect(getClientIp(null, null, null)).toBe('unknown');
	});

	it('trims whitespace from IPs', () => {
		expect(getClientIp('  1.2.3.4  ', null, null)).toBe('1.2.3.4');
	});

	it('handles empty strings as missing', () => {
		expect(getClientIp('', '', '')).toBe('unknown');
	});
});

describe('extractIdentifier', () => {
	it('uses IP for torrents paths', () => {
		expect(extractIdentifier('/api/torrents/search', '1.2.3.4', null, null)).toBe('1.2.3.4');
	});

	it('extracts user ID from stremio paths', () => {
		expect(extractIdentifier('/api/stremio/ABCDEF12345/stream/movie', null, null, null)).toBe(
			'ABCDEF12345'
		);
	});

	it('extracts user ID from stremio-tb paths', () => {
		expect(
			extractIdentifier('/api/stremio-tb/ABCDEF12345/stream/movie', null, null, null)
		).toBe('ABCDEF12345');
	});

	it('falls back to IP when user ID is not found', () => {
		expect(extractIdentifier('/api/other', '1.2.3.4', null, null)).toBe('1.2.3.4');
	});
});

describe('shouldRateLimit', () => {
	it('returns true for stremio paths', () => {
		expect(shouldRateLimit('/api/stremio/abc')).toBe(true);
	});

	it('returns true for torrents paths', () => {
		expect(shouldRateLimit('/api/torrents/search')).toBe(true);
	});

	it('returns false for other paths', () => {
		expect(shouldRateLimit('/api/settings')).toBe(false);
		expect(shouldRateLimit('/login')).toBe(false);
	});
});

describe('InMemoryRateLimiter', () => {
	let limiter: InMemoryRateLimiter;

	beforeEach(() => {
		limiter = new InMemoryRateLimiter();
	});

	it('allows requests within the rate limit', () => {
		const config = { rateLimit: 3, windowSeconds: 10 };
		const r1 = limiter.check('user1', config);
		expect(r1.success).toBe(true);
		expect(r1.remaining).toBe(2);
		expect(r1.limit).toBe(3);

		const r2 = limiter.check('user1', config);
		expect(r2.success).toBe(true);
		expect(r2.remaining).toBe(1);

		const r3 = limiter.check('user1', config);
		expect(r3.success).toBe(true);
		expect(r3.remaining).toBe(0);
	});

	it('blocks requests exceeding the rate limit', () => {
		const config = { rateLimit: 1, windowSeconds: 10 };
		limiter.check('user1', config);
		const result = limiter.check('user1', config);
		expect(result.success).toBe(false);
		expect(result.remaining).toBe(0);
	});

	it('tracks different identifiers independently', () => {
		const config = { rateLimit: 1, windowSeconds: 10 };
		const r1 = limiter.check('user1', config);
		const r2 = limiter.check('user2', config);
		expect(r1.success).toBe(true);
		expect(r2.success).toBe(true);
	});

	it('separates rate limit buckets by windowSeconds', () => {
		const config1 = { rateLimit: 1, windowSeconds: 5 };
		const config2 = { rateLimit: 1, windowSeconds: 10 };
		const r1 = limiter.check('user1', config1);
		const r2 = limiter.check('user1', config2);
		expect(r1.success).toBe(true);
		expect(r2.success).toBe(true);
	});

	it('resets after window expires', () => {
		const config = { rateLimit: 1, windowSeconds: 1 };
		limiter.check('user1', config);

		vi.useFakeTimers();
		vi.advanceTimersByTime(1100);
		const result = limiter.check('user1', config);
		expect(result.success).toBe(true);
		vi.useRealTimers();
	});

	it('cleanup removes expired entries', () => {
		const config = { rateLimit: 1, windowSeconds: 1 };
		limiter.check('user1', config);
		expect(limiter.size()).toBe(1);

		limiter.cleanup(Date.now() + 2000);
		expect(limiter.size()).toBe(0);
	});

	it('clear removes all entries', () => {
		const config = { rateLimit: 5, windowSeconds: 10 };
		limiter.check('user1', config);
		limiter.check('user2', config);
		expect(limiter.size()).toBe(2);

		limiter.clear();
		expect(limiter.size()).toBe(0);
	});
});
