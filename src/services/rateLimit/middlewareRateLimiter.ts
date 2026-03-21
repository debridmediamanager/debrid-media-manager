import Redis from 'ioredis';

// Rate limit configs for different endpoint types
export const RATE_LIMIT_CONFIGS = {
	stream: { rateLimit: 1, windowSeconds: 5 }, // 1 request per 5 seconds for stream endpoints
	torrents: { rateLimit: 1, windowSeconds: 2 }, // 1 request per 2 seconds for torrents API
	proxy: { rateLimit: 3, windowSeconds: 1 }, // 3 requests per second for proxy endpoints
	report: { rateLimit: 5, windowSeconds: 10 }, // 5 reports per 10 seconds
	default: { rateLimit: 5, windowSeconds: 1 }, // 5 requests per second for other endpoints
} as const;

export const REDIS_CHECK_INTERVAL = 30_000; // Re-check Redis availability every 30s

export interface RateLimitResult {
	success: boolean;
	remaining: number;
	reset: number;
	limit: number;
}

export interface RateLimitConfig {
	rateLimit: number;
	windowSeconds: number;
}

/**
 * Determine which rate limit config to use based on the path
 */
export function getRateLimitConfig(pathname: string): RateLimitConfig {
	// Stream endpoints: /api/stremio[-tb|-ad]/USERID/stream/...
	if (/^\/api\/stremio(?:-tb|-ad)?\/[A-Za-z0-9]+\/stream\//.test(pathname)) {
		return RATE_LIMIT_CONFIGS.stream;
	}
	// Torrents API endpoints
	if (pathname.startsWith('/api/torrents')) {
		return RATE_LIMIT_CONFIGS.torrents;
	}
	return RATE_LIMIT_CONFIGS.default;
}

/**
 * In-memory fallback rate limiter using a Map
 * Supports per-request config for different rate limits based on endpoint
 */
export class InMemoryRateLimiter {
	private map = new Map<string, { count: number; resetTime: number; windowSeconds: number }>();

	check(identifier: string, config: RateLimitConfig): RateLimitResult {
		const now = Date.now();
		const windowMs = config.windowSeconds * 1000;
		// Use a composite key that includes the window to separate different rate limit buckets
		const key = `${identifier}:${config.windowSeconds}`;
		const userLimit = this.map.get(key);

		// Clean up old entries periodically (1% chance per request)
		if (Math.random() < 0.01) {
			this.cleanup(now);
		}

		if (!userLimit || now > userLimit.resetTime) {
			this.map.set(key, {
				count: 1,
				resetTime: now + windowMs,
				windowSeconds: config.windowSeconds,
			});
			return {
				success: true,
				remaining: config.rateLimit - 1,
				reset: now + windowMs,
				limit: config.rateLimit,
			};
		}

		if (userLimit.count >= config.rateLimit) {
			return {
				success: false,
				remaining: 0,
				reset: userLimit.resetTime,
				limit: config.rateLimit,
			};
		}

		userLimit.count++;
		return {
			success: true,
			remaining: config.rateLimit - userLimit.count,
			reset: userLimit.resetTime,
			limit: config.rateLimit,
		};
	}

	cleanup(now: number = Date.now()): void {
		for (const [key, value] of this.map.entries()) {
			if (now > value.resetTime) {
				this.map.delete(key);
			}
		}
	}

	clear(): void {
		this.map.clear();
	}

	size(): number {
		return this.map.size;
	}
}

/**
 * Redis-based rate limiter using sliding window with sorted sets
 * Supports per-request config for different rate limits based on endpoint
 */
export class RedisRateLimiter {
	constructor(private client: Redis) {}

	async check(identifier: string, config: RateLimitConfig): Promise<RateLimitResult> {
		// Include window in key to separate different rate limit buckets
		const key = `ratelimit:${identifier}:${config.windowSeconds}`;
		const now = Math.floor(Date.now() / 1000);
		const windowStart = now - config.windowSeconds;

		// Use Redis pipeline for atomic operations
		const pipeline = this.client.pipeline();

		// Remove old entries outside the window
		pipeline.zremrangebyscore(key, 0, windowStart);
		// Add current request
		pipeline.zadd(key, now, `${now}:${Math.random()}`);
		// Count requests in window
		pipeline.zcard(key);
		// Set expiry
		pipeline.expire(key, config.windowSeconds);

		const results = await pipeline.exec();
		const count = (results?.[2]?.[1] as number) || 0;

		const success = count <= config.rateLimit;
		const remaining = Math.max(0, config.rateLimit - count);
		const reset = (now + config.windowSeconds) * 1000;

		return { success, remaining, reset, limit: config.rateLimit };
	}
}

/**
 * Hybrid rate limiter that uses Redis when available, falls back to in-memory
 * Supports per-request config for different rate limits based on endpoint
 */
export class HybridRateLimiter {
	private redis: Redis | null = null;
	private redisRateLimiter: RedisRateLimiter | null = null;
	private inMemoryRateLimiter: InMemoryRateLimiter;
	private redisAvailable = true;
	private lastRedisCheck = 0;

	constructor(private redisUrl: string | undefined) {
		this.inMemoryRateLimiter = new InMemoryRateLimiter();
	}

	private initRedis(): Redis | null {
		if (this.redis) return this.redis;

		if (!this.redisUrl) {
			console.warn('[RateLimit] REDIS_URL not configured, using in-memory fallback');
			this.redisAvailable = false;
			return null;
		}

		try {
			this.redis = new Redis(this.redisUrl, {
				maxRetriesPerRequest: 1,
				retryStrategy: () => null,
				connectTimeout: 2000,
				commandTimeout: 1000,
				lazyConnect: true,
			});

			this.redis.on('error', (err) => {
				console.error('[RateLimit] Redis error:', err.message);
				this.redisAvailable = false;
			});

			this.redis.on('connect', () => {
				console.log('[RateLimit] Redis connected');
				this.redisAvailable = true;
			});

			this.redisRateLimiter = new RedisRateLimiter(this.redis);
			return this.redis;
		} catch (error) {
			console.error('[RateLimit] Failed to initialize Redis:', error);
			this.redisAvailable = false;
			return null;
		}
	}

	async check(identifier: string, config: RateLimitConfig): Promise<RateLimitResult> {
		const client = this.initRedis();
		const now = Date.now();

		// Try Redis if available
		if (client && this.redisRateLimiter && this.redisAvailable) {
			try {
				return await this.redisRateLimiter.check(identifier, config);
			} catch (error) {
				console.error('[RateLimit] Redis error, falling back to in-memory:', error);
				this.redisAvailable = false;
				this.lastRedisCheck = now;
			}
		} else {
			// Re-enable Redis check periodically
			if (!this.redisAvailable && now - this.lastRedisCheck > REDIS_CHECK_INTERVAL) {
				this.redisAvailable = true;
				this.lastRedisCheck = now;
			}
		}

		return this.inMemoryRateLimiter.check(identifier, config);
	}

	isRedisAvailable(): boolean {
		return this.redisAvailable;
	}

	async disconnect(): Promise<void> {
		if (this.redis) {
			await this.redis.quit();
			this.redis = null;
			this.redisRateLimiter = null;
		}
	}
}

/**
 * Get client IP from request headers.
 * Priority: cf-connecting-ip (Cloudflare) > x-real-ip (nginx) > x-forwarded-for > unknown
 */
export function getClientIp(
	cfConnectingIp: string | null,
	xRealIp: string | null,
	xForwardedFor: string | null
): string {
	if (cfConnectingIp?.trim()) {
		return cfConnectingIp.trim();
	}
	if (xRealIp?.trim()) {
		return xRealIp.trim();
	}
	if (xForwardedFor?.trim()) {
		return xForwardedFor.split(',')[0]?.trim() || 'unknown';
	}
	return 'unknown';
}

/**
 * Extract identifier for rate limiting
 * - For Stremio endpoints: use user ID from path, fallback to IP
 * - For Torrents endpoints: always use IP
 */
export function extractIdentifier(
	pathname: string,
	cfConnectingIp: string | null,
	xRealIp: string | null,
	xForwardedFor: string | null
): string {
	// For torrents API, always use IP-based rate limiting
	if (pathname.startsWith('/api/torrents')) {
		return getClientIp(cfConnectingIp, xRealIp, xForwardedFor);
	}

	// For Stremio API, try to extract user ID from path
	const match = pathname.match(/^\/api\/stremio(?:-tb|-ad)?\/([A-Za-z0-9]{10,})/);
	const userId = match?.[1];
	if (userId) {
		return userId;
	}

	// Fallback to IP
	return getClientIp(cfConnectingIp, xRealIp, xForwardedFor);
}

/**
 * Check if path should be rate limited
 */
export function shouldRateLimit(pathname: string): boolean {
	return pathname.startsWith('/api/stremio') || pathname.startsWith('/api/torrents');
}
