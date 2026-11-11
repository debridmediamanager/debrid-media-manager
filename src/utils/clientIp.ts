import { NextApiRequest } from 'next';

/**
 * Get client IP from request headers.
 * Priority: x-real-ip (nginx) > cf-connecting-ip (Cloudflare) > x-forwarded-for > socket remote address
 * (why x-real-ip first: see getClientIp in services/rateLimit/middlewareRateLimiter).
 */
export function getClientIpFromRequest(req: NextApiRequest): string {
	const xRealIp = req.headers['x-real-ip'] as string | undefined;
	if (xRealIp?.trim()) {
		return xRealIp.trim();
	}
	const cfIp = req.headers['cf-connecting-ip'] as string | undefined;
	if (cfIp?.trim()) {
		return cfIp.trim();
	}
	const xForwardedFor = req.headers['x-forwarded-for'] as string | undefined;
	if (xForwardedFor?.trim()) {
		return xForwardedFor.split(',')[0]?.trim() || '';
	}
	return req.socket?.remoteAddress ?? '';
}
