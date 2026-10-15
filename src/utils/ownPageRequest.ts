import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Whether a request came from one of DMM's own pages. Routes the site's pages call
 * answer what the sponsor API sells (identify, availability, media info), and on
 * 2026-10-11..15 python-requests, rd-catalog, PlexShowRecovery and others called
 * them directly, some with a forged DMM Referer, so Referer proves nothing.
 *
 * Browsers send `Sec-Fetch-Site` on every https request and page script cannot set
 * it. They send none over plain http, which is how a self-hosted DMM on a LAN
 * address is reached; NPM forces https on debridmediamanager.com and sets
 * `x-forwarded-proto` itself, so that exception never applies there.
 */
export function isOwnPageRequest(req: NextApiRequest): boolean {
	const site = req.headers['sec-fetch-site'];
	if (site !== undefined) return site === 'same-origin';
	const proto =
		req.headers['x-forwarded-proto'] ??
		((req.socket as { encrypted?: boolean } | undefined)?.encrypted ? 'https' : 'http');
	return proto === 'http';
}

/** Refuses a request that did not come from a DMM page, pointing tools at the sponsor API. */
export function validateOwnPageRequest(req: NextApiRequest, res: NextApiResponse): boolean {
	if (isOwnPageRequest(req)) return true;
	res.status(403).json({
		error: 'This endpoint serves DMM pages only. Tools use the sponsor API: https://debridmediamanager.com/api-docs',
	});
	return false;
}
