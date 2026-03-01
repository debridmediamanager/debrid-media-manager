import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

import {
	extractIdentifier,
	getClientIp,
	getRateLimitConfig,
	HybridRateLimiter,
	RATE_LIMIT_CONFIGS,
	RateLimitConfig,
} from './middlewareRateLimiter';

// Re-export for convenience
export { RATE_LIMIT_CONFIGS };

// Singleton rate limiter instance
let rateLimiter: HybridRateLimiter | null = null;

function getRateLimiter(): HybridRateLimiter {
	if (!rateLimiter) {
		rateLimiter = new HybridRateLimiter(process.env.REDIS_URL);
	}
	return rateLimiter;
}

/**
 * Get identifier for rate limiting based on request
 */
function getIdentifier(req: NextApiRequest, pathname: string): string {
	const xRealIp = req.headers['x-real-ip'] as string | undefined;
	const xForwardedFor = req.headers['x-forwarded-for'] as string | undefined;
	return extractIdentifier(pathname, xRealIp || null, xForwardedFor || null);
}

/**
 * Higher-order function that wraps an API handler with rate limiting
 */
export function withRateLimit(handler: NextApiHandler): NextApiHandler {
	return async (req: NextApiRequest, res: NextApiResponse) => {
		const pathname = req.url?.split('?')[0] || '';
		const identifier = getIdentifier(req, pathname);
		const config = getRateLimitConfig(pathname);

		const limiter = getRateLimiter();
		const now = Date.now();

		const { success, remaining, reset, limit } = await limiter.check(identifier, config);

		// Add rate limit headers
		res.setHeader('X-RateLimit-Limit', String(limit));
		res.setHeader('X-RateLimit-Remaining', String(remaining));
		res.setHeader('X-RateLimit-Reset', String(reset));

		if (!success) {
			res.setHeader('Retry-After', String(Math.ceil((reset - now) / 1000)));
			return res.status(429).json({ error: 'Rate limit exceeded' });
		}

		return handler(req, res);
	};
}

/**
 * Higher-order function with custom rate limit config
 */
export function withCustomRateLimit(
	handler: NextApiHandler,
	config: RateLimitConfig
): NextApiHandler {
	return async (req: NextApiRequest, res: NextApiResponse) => {
		const pathname = req.url?.split('?')[0] || '';
		const identifier = getIdentifier(req, pathname);

		const limiter = getRateLimiter();
		const now = Date.now();

		const { success, remaining, reset, limit } = await limiter.check(identifier, config);

		// Add rate limit headers
		res.setHeader('X-RateLimit-Limit', String(limit));
		res.setHeader('X-RateLimit-Remaining', String(remaining));
		res.setHeader('X-RateLimit-Reset', String(reset));

		if (!success) {
			res.setHeader('Retry-After', String(Math.ceil((reset - now) / 1000)));
			return res.status(429).json({ error: 'Rate limit exceeded' });
		}

		return handler(req, res);
	};
}

/**
 * For use in API routes that need IP-based rate limiting (like torrents)
 */
export function withIpRateLimit(handler: NextApiHandler, config: RateLimitConfig): NextApiHandler {
	return async (req: NextApiRequest, res: NextApiResponse) => {
		const xRealIp = req.headers['x-real-ip'] as string | undefined;
		const xForwardedFor = req.headers['x-forwarded-for'] as string | undefined;
		const identifier = getClientIp(xRealIp || null, xForwardedFor || null);

		const limiter = getRateLimiter();
		const now = Date.now();

		const { success, remaining, reset, limit } = await limiter.check(identifier, config);

		// Add rate limit headers
		res.setHeader('X-RateLimit-Limit', String(limit));
		res.setHeader('X-RateLimit-Remaining', String(remaining));
		res.setHeader('X-RateLimit-Reset', String(reset));

		if (!success) {
			res.setHeader('Retry-After', String(Math.ceil((reset - now) / 1000)));
			return res.status(429).json({ error: 'Rate limit exceeded' });
		}

		return handler(req, res);
	};
}
