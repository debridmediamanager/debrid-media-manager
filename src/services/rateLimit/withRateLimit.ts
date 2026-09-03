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

// Parsed whitelist IPs (cached after first access)
let whitelistedIps: Set<string> | null = null;

function getWhitelistedIps(): Set<string> {
	if (!whitelistedIps) {
		const raw = process.env.RATE_LIMIT_WHITELIST_IPS || '';
		whitelistedIps = new Set(
			raw
				.split(',')
				.map((ip) => ip.trim())
				.filter(Boolean)
		);
	}
	return whitelistedIps;
}

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
	const cfConnectingIp = req.headers['cf-connecting-ip'] as string | undefined;
	const xRealIp = req.headers['x-real-ip'] as string | undefined;
	const xForwardedFor = req.headers['x-forwarded-for'] as string | undefined;
	return extractIdentifier(
		pathname,
		cfConnectingIp || null,
		xRealIp || null,
		xForwardedFor || null
	);
}

/**
 * Runs the limiter and writes the X-RateLimit-* headers, returning whether the
 * request may proceed. On refusal it sets Retry-After but writes no body: what
 * an exceeded limit looks like on the wire is the caller's decision.
 *
 * Whitelisting is deliberately left out here — every caller checks it first and
 * skips the limiter entirely, which is what keeps a whitelisted request from
 * carrying rate limit headers.
 */
async function applyRateLimit(
	identifier: string,
	config: RateLimitConfig,
	res: NextApiResponse
): Promise<boolean> {
	const limiter = getRateLimiter();
	const now = Date.now();

	const { success, remaining, reset, limit } = await limiter.check(identifier, config);

	// Add rate limit headers
	res.setHeader('X-RateLimit-Limit', String(limit));
	res.setHeader('X-RateLimit-Remaining', String(remaining));
	res.setHeader('X-RateLimit-Reset', String(reset));

	if (!success) {
		res.setHeader('Retry-After', String(Math.ceil((reset - now) / 1000)));
		return false;
	}

	return true;
}

/**
 * Rate limit check for a handler that has to write its own refusal body.
 *
 * The wrappers below answer an exceeded limit with `{"error": ...}`, which a
 * Newznab client cannot read — it expects an `<error code=.../>` document, and
 * several clients report a JSON body as an unreachable indexer rather than as a
 * throttle. This applies the same limiter and the same headers, then hands the
 * verdict back so the caller can answer in its own protocol.
 *
 * The identifier is the caller's to choose: the Newznab routes key on the
 * sponsor's API key rather than on an IP, so one sponsor's *arr fleet shares one
 * budget wherever it runs from.
 */
export async function checkRateLimitFor(
	identifier: string,
	config: RateLimitConfig,
	res: NextApiResponse
): Promise<boolean> {
	if (getWhitelistedIps().has(identifier)) {
		return true;
	}

	return applyRateLimit(identifier, config, res);
}

/**
 * Higher-order function that wraps an API handler with rate limiting
 */
export function withRateLimit(handler: NextApiHandler): NextApiHandler {
	return async (req: NextApiRequest, res: NextApiResponse) => {
		const pathname = req.url?.split('?')[0] || '';
		const identifier = getIdentifier(req, pathname);

		if (getWhitelistedIps().has(identifier)) {
			return handler(req, res);
		}

		const config = getRateLimitConfig(pathname);

		if (!(await applyRateLimit(identifier, config, res))) {
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

		if (getWhitelistedIps().has(identifier)) {
			return handler(req, res);
		}

		if (!(await applyRateLimit(identifier, config, res))) {
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
		const cfConnectingIp = req.headers['cf-connecting-ip'] as string | undefined;
		const xRealIp = req.headers['x-real-ip'] as string | undefined;
		const xForwardedFor = req.headers['x-forwarded-for'] as string | undefined;
		const identifier = getClientIp(
			cfConnectingIp || null,
			xRealIp || null,
			xForwardedFor || null
		);

		if (getWhitelistedIps().has(identifier)) {
			return handler(req, res);
		}

		if (!(await applyRateLimit(identifier, config, res))) {
			return res.status(429).json({ error: 'Rate limit exceeded' });
		}

		return handler(req, res);
	};
}
