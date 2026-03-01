import { NextApiRequest } from 'next';

/**
 * Get client IP from request headers.
 * Priority: cf-connecting-ip (Cloudflare) > x-real-ip (nginx) > x-forwarded-for > socket remote address
 */
export function getClientIpFromRequest(req: NextApiRequest): string {
	const cfIp = req.headers['cf-connecting-ip'] as string | undefined;
	if (cfIp?.trim()) {
		return cfIp.trim();
	}
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
