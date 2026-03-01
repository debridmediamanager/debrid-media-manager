import { NextApiRequest } from 'next';

/**
 * Get client IP from request headers (behind nginx proxy manager).
 * Priority: x-real-ip > x-forwarded-for (first IP) > socket remote address
 */
export function getClientIpFromRequest(req: NextApiRequest): string {
	const xRealIp = req.headers['x-real-ip'] as string | undefined;
	if (xRealIp?.trim()) {
		return xRealIp.trim();
	}
	const xForwardedFor = req.headers['x-forwarded-for'] as string | undefined;
	if (xForwardedFor?.trim()) {
		return xForwardedFor.split(',')[0]?.trim() || '';
	}
	return req.socket.remoteAddress ?? '';
}
