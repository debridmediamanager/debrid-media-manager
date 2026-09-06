import { NEWZNAB_AUTH_MESSAGES, resolveNewznabSponsor } from '@/services/newznab/auth';
import { getClientIp } from '@/services/rateLimit/middlewareRateLimiter';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { isSearchType } from '@/services/torznab/resolve';
import { parseFeedOptions, runSearch } from '@/services/torznab/search';
import { capsXml, searchRssXml, torznabErrorXml } from '@/services/torznab/xml';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * DMM as a Torznab indexer, for sponsors' own Prowlarr / Sonarr / Radarr.
 *
 * The Newznab endpoint next door fans a search out to a fleet of paid Usenet
 * indexers and has to spend the rest of its effort hiding which ones. This one
 * has no upstream to hide: the answers come from DMM's own torrent library and
 * from debridio filling a title nothing has scraped yet, and the download is the
 * infohash itself — which is not a secret, it is the thing the whole site is
 * built out of. So there is no opaque id, no proxied grab and no `t=get`: an
 * item's download is a magnet the client resolves against its own debrid
 * account, and DMM is never in that path.
 *
 * A catch-all route because the feed's variants live in the path. An *arr
 * appends `/api` to whatever indexer URL it is given, so `/api/torznab` is the
 * plain feed and `/api/torznab/rd/cached` is "only what Real-Debrid already
 * holds" — see `parseFeedOptions` for why this is not a query parameter.
 *
 * Errors are Torznab `<error/>` documents with **HTTP 200**, the same protocol
 * Newznab uses, for the same reason: several clients treat a non-200 as an
 * unreachable indexer without ever reading the reason.
 */

const XML_CONTENT_TYPE = 'application/xml; charset=utf-8';

function sendError(res: NextApiResponse, status: number, code: number, description: string) {
	res.setHeader('Content-Type', XML_CONTENT_TYPE);
	return res.status(status).send(torznabErrorXml(code, description));
}

function firstValue(value: string | string[] | undefined): string {
	const raw = Array.isArray(value) ? value[0] : value;
	return typeof raw === 'string' ? raw.trim() : '';
}

/** The same header fold `withRateLimit` applies, for the same proxy chain. */
function clientIp(req: NextApiRequest): string {
	return getClientIp(
		(req.headers['cf-connecting-ip'] as string) || null,
		(req.headers['x-real-ip'] as string) || null,
		(req.headers['x-forwarded-for'] as string) || null
	);
}

/**
 * The path an *arr actually requested, minus the `/api` it appends itself.
 * Anything else — a stray segment, a missing `/api` — is not this endpoint.
 */
function feedSegments(req: NextApiRequest): string[] | null {
	const route = req.query.route;
	const segments = Array.isArray(route) ? route : typeof route === 'string' ? [route] : [];
	if (segments[segments.length - 1] !== 'api') return null;
	return segments.slice(0, -1);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		return sendError(res, 405, 202, 'No such function');
	}

	// The cheap pre-auth reject, per IP, before any database lookup. In the
	// protocol rather than through `withIpRateLimit`: that wrapper answers with a
	// JSON body, which an *arr logs as a broken indexer instead of backing off.
	if (!(await checkRateLimitFor(clientIp(req), RATE_LIMIT_CONFIGS.torznabIp, res))) {
		return sendError(res, 429, 500, 'Request limit reached');
	}

	const segments = feedSegments(req);
	const options = segments === null ? null : parseFeedOptions(segments);
	if (!options) return sendError(res, 200, 202, 'No such function');

	const t = firstValue(req.query.t).toLowerCase();

	// Unauthenticated on purpose: Prowlarr fetches caps before it has been given
	// a key and reports the indexer as broken if that fetch does not answer. The
	// document is static and names nothing, so there is nothing to gate.
	if (t === 'caps') {
		res.setHeader('Cache-Control', 'public, s-maxage=3600');
		res.setHeader('Content-Type', XML_CONTENT_TYPE);
		return res.status(200).send(capsXml());
	}

	if (!isSearchType(t)) return sendError(res, 200, 202, 'No such function');

	try {
		// Torznab's credential codes are Newznab's, and so is the gate behind
		// them: `Sponsors.dmmApiKey` with a live sponsorship check, answering 100
		// and 101 differently so a lapsed sponsor is not left re-copying a key
		// that was never the problem.
		const auth = await resolveNewznabSponsor(req);
		if ('errorCode' in auth) {
			return sendError(res, 200, auth.errorCode, NEWZNAB_AUTH_MESSAGES[auth.errorCode]);
		}

		// Keyed on the sponsorship rather than an IP: one sponsor's *arr fleet
		// shares one budget wherever the boxes run from. There is no grab budget
		// to spend here — a grab never comes back to DMM.
		const identifier = `sponsor:${auth.sponsor.shortId}`;
		if (!(await checkRateLimitFor(identifier, RATE_LIMIT_CONFIGS.torznabSearch, res))) {
			return sendError(res, 429, 500, 'Request limit reached');
		}

		const { items, offset, total } = await runSearch(t, req.query, options);

		res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
		return res.status(200).send(searchRssXml(items, offset, total));
	} catch (error) {
		// A Next.js 500 is an HTML page, which an *arr logs as an unreachable
		// indexer. Say it in the protocol instead.
		console.error('Torznab endpoint failed:', error);
		return sendError(res, 200, 900, 'Unknown error');
	}
}

export default handler;
