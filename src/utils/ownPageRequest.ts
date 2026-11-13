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

/**
 * A native app rather than a browser: it sends neither `Sec-Fetch-Site` nor `Origin`,
 * while a browser sends at least one on any write, and every write a page can make to
 * another site carries `Origin`. Anyone can send neither, so only together with a provider
 * login the route verifies: browser-state, and the library identification and stored probes
 * the DMM Mobile app names and describes its user's own library with (Ben's call,
 * 2026-11-12). Never on its own.
 */
export function isNativeAppRequest(req: NextApiRequest): boolean {
	return req.headers['sec-fetch-site'] === undefined && req.headers.origin === undefined;
}
