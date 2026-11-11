import { getClientIpFromRequest } from '@/utils/clientIp';
import type { NextApiRequest } from 'next';

/**
 * Cloudflare Turnstile in front of /api/challenge, the one route that hands DMM's
 * pages the token every torrent, availability and report route asks for. Scripts
 * that faked a browser well enough to pass the Sec-Fetch-Site check still have to
 * pass this, which takes a real, unflagged browser.
 *
 * Only the web app sees it: tools use the sponsor API on a DMM API key, which never
 * goes through /api/challenge. Off unless both keys are set, so a self-hosted DMM
 * or a test rig behaves exactly as before.
 */
export const TURNSTILE_HEADER = 'x-turnstile-token';
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function turnstileSiteKey(): string | null {
	const site = process.env.TURNSTILE_SITE_KEY;
	return site && process.env.TURNSTILE_SECRET_KEY ? site : null;
}

export type TurnstileVerdict = 'pass' | 'fail' | 'unreachable';

/** Asks Cloudflare whether the browser solved the challenge just now. Each answer is single use. */
export async function verifyTurnstile(req: NextApiRequest): Promise<TurnstileVerdict> {
	const response = req.headers[TURNSTILE_HEADER];
	if (typeof response !== 'string' || !response || response.length > 2048) return 'fail';
	const body = new URLSearchParams({
		secret: process.env.TURNSTILE_SECRET_KEY ?? '',
		response,
	});
	const ip = getClientIpFromRequest(req);
	if (ip) body.set('remoteip', ip);
	try {
		const res = await fetch(SITEVERIFY, {
			method: 'POST',
			body,
			signal: AbortSignal.timeout(5000),
		});
		if (!res.ok) return 'unreachable';
		const data = (await res.json()) as { success?: boolean };
		return data.success === true ? 'pass' : 'fail';
	} catch {
		return 'unreachable';
	}
}
