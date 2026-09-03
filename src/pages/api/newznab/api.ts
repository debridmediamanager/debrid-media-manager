import {
	NEWZNAB_AUTH_MESSAGES,
	newznabApiKey,
	resolveNewznabSponsor,
} from '@/services/newznab/auth';
import { getUpstreamIndexers } from '@/services/newznab/indexers';
import { decryptReleaseId, hasTokenSecret } from '@/services/newznab/opaqueId';
import { isSearchType, runSearch } from '@/services/newznab/search';
import { getStoredNzb, putStoredNzb } from '@/services/newznab/store';
import { capsXml, newznabErrorXml, searchRssXml } from '@/services/newznab/xml';
import { fetchNzbFrom } from '@/services/nzb2rd';
import { getClientIp } from '@/services/rateLimit/middlewareRateLimiter';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { safeNzbName } from '@/utils/nzbName';
import { NzbSanitizeError, sanitizeNzb } from '@/utils/nzbSanitize';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * DMM as a Newznab indexer, for sponsors' own Prowlarr / Sonarr / Radarr.
 *
 * The route is `/api/newznab/api` because an *arr appends its own `/api` to the
 * indexer URL a user types — so the URL on the setup page is `/api/newznab`.
 *
 * What this endpoint is FOR is worth stating, because it shapes every decision
 * below: it fans one search out to the whole upstream indexer fleet and answers
 * as a single indexer, without ever telling the client which servers those are.
 * An upstream `link` carries the operator's API key in its `&r=` parameter, and
 * even a bare qualified id (`ds:abc123`) names the accounts DMM pays for — so
 * ids are encrypted, enclosures point back here, and no upstream field is
 * copied through. Nothing may be added to the feed that undoes that.
 *
 * Errors are Newznab `<error/>` documents with **HTTP 200**, not JSON and not a
 * 4xx. Several clients treat a non-200 as an unreachable indexer without ever
 * reading the reason, and SABnzbd shows the description when a grab fails — a
 * 502 with a JSON body reads to it as a corrupt download instead.
 */

const XML_CONTENT_TYPE = 'application/xml; charset=utf-8';

function sendError(res: NextApiResponse, status: number, code: number, description: string) {
	res.setHeader('Content-Type', XML_CONTENT_TYPE);
	return res.status(status).send(newznabErrorXml(code, description));
}

function firstValue(value: string | string[] | undefined): string {
	const raw = Array.isArray(value) ? value[0] : value;
	return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * The `filename` fallback for clients that ignore `filename*` — the same fold
 * `nzb2rd/download.ts` applies, for the same reason: a quote or a backslash
 * would end the parameter early and a non-ASCII byte is undefined behaviour.
 */
function asciiFilename(name: string): string {
	return name.replace(/[\\"]/g, '').replace(/[^\x20-\x7e]/g, '_');
}

function sendNzb(res: NextApiResponse, token: string, xml: string, removed: string) {
	const name = safeNzbName(token);
	res.setHeader('X-Nzb-Removed', removed.replace(/[^\x20-\x7e]/g, '') || '-');
	res.setHeader('Content-Type', 'application/x-nzb; charset=utf-8');
	res.setHeader(
		'Content-Disposition',
		`attachment; filename="${asciiFilename(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`
	);
	return res.status(200).send(xml);
}

/** HTTP 429 with a body a Newznab client can actually read. */
function sendRateLimited(res: NextApiResponse) {
	return sendError(res, 429, 500, 'Request limit reached');
}

async function handleSearch(req: NextApiRequest, res: NextApiResponse, t: string) {
	const auth = await resolveNewznabSponsor(req);
	if ('errorCode' in auth) {
		return sendError(res, 200, auth.errorCode, NEWZNAB_AUTH_MESSAGES[auth.errorCode]);
	}

	// Keyed on the sponsorship, not on an IP: one sponsor's *arr fleet shares one
	// budget wherever the boxes run from.
	const identifier = `sponsor:${auth.sponsor.shortId}`;
	if (!(await checkRateLimitFor(identifier, RATE_LIMIT_CONFIGS.newznabSearch, res))) {
		return sendRateLimited(res);
	}

	// The caller's own key goes into every enclosure URL, so the grab that
	// follows one arrives authenticated even for a client that authenticated by
	// header. A client that reads the query string sees only its own key.
	const { items, offset, total } = await runSearch(t, {
		...req.query,
		apikey: newznabApiKey(req),
	});

	res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
	return res.status(200).send(searchRssXml(items, offset, total));
}

async function handleGrab(req: NextApiRequest, res: NextApiResponse) {
	const auth = await resolveNewznabSponsor(req);
	if ('errorCode' in auth) {
		return sendError(res, 200, auth.errorCode, NEWZNAB_AUTH_MESSAGES[auth.errorCode]);
	}

	// Both budgets, in order: a grab spends a real download from the shared
	// upstream account, so it carries a burst limit and a day-long one. The burst
	// check runs first so a client hammering it does not also burn the day's.
	const identifier = `sponsor:${auth.sponsor.shortId}`;
	if (!(await checkRateLimitFor(identifier, RATE_LIMIT_CONFIGS.newznabGrab, res))) {
		return sendRateLimited(res);
	}
	if (!(await checkRateLimitFor(identifier, RATE_LIMIT_CONFIGS.newznabGrabDay, res))) {
		return sendRateLimited(res);
	}

	const token = firstValue(req.query.id);
	const release = decryptReleaseId(token);
	// Forged, truncated, or minted under a rotated secret. All of them are "no
	// such item" to the client; which one it was is not its business.
	if (!release) return sendError(res, 200, 300, 'No such item');

	// The store is where a re-grab of the same release costs nothing: an NZB is
	// immutable once posted, so only the first fetch spends an upstream call.
	const stored = await getStoredNzb(release.prefix, release.nativeId);
	if (stored) return sendNzb(res, token, stored, '-');

	const indexer = getUpstreamIndexers().find((candidate) => candidate.prefix === release.prefix);
	// A token minted before an indexer was removed from the config. Nothing can
	// serve it any more, which is exactly what 300 means.
	if (!indexer) return sendError(res, 200, 300, 'No such item');

	let raw: string;
	try {
		raw = await fetchNzbFrom(indexer, release.nativeId);
	} catch (error) {
		// Logged with the indexer's name; answered without it. `fetchNzbFrom`
		// names the server in its message, and that name is the one thing this
		// endpoint exists to keep out of a client's hands.
		console.error('Newznab grab failed upstream:', error);
		return sendError(res, 200, 300, 'That release could not be downloaded');
	}

	let cleaned;
	try {
		cleaned = sanitizeNzb(raw);
	} catch (error) {
		if (error instanceof NzbSanitizeError) {
			// Describes the NZB, never the server it came from — safe to pass on,
			// and SABnzbd shows it.
			return sendError(res, 200, 300, error.message);
		}
		throw error;
	}

	// Fire and forget: a write that did not land only means the next grab of this
	// release pays for another upstream call, and B2 write timeouts run to 15s.
	void putStoredNzb(release.prefix, release.nativeId, cleaned.xml).catch((error) => {
		console.error('Newznab NZB store write failed:', error);
	});

	return sendNzb(res, token, cleaned.xml, cleaned.removed.join('; '));
}

/** The same header fold `withRateLimit` applies, for the same proxy chain. */
function clientIp(req: NextApiRequest): string {
	return getClientIp(
		(req.headers['cf-connecting-ip'] as string) || null,
		(req.headers['x-real-ip'] as string) || null,
		(req.headers['x-forwarded-for'] as string) || null
	);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		return sendError(res, 405, 202, 'No such function');
	}

	// The cheap pre-auth reject, per IP, before any DB lookup. In the protocol,
	// not `withIpRateLimit`: that wrapper answers a 429 with a JSON body, which
	// an *arr logs as a broken indexer instead of backing off — and its
	// `default` config trips at 5/s, under a Sonarr interactive search burst.
	if (!(await checkRateLimitFor(clientIp(req), RATE_LIMIT_CONFIGS.newznabIp, res))) {
		return sendError(res, 429, 500, 'Request limit reached');
	}

	const t = firstValue(req.query.t).toLowerCase();

	// Unauthenticated on purpose: Prowlarr fetches caps before it has been given
	// a key, and reports the indexer as broken if that fetch does not answer.
	// It is a static document naming no upstream, so there is nothing to gate.
	if (t === 'caps') {
		res.setHeader('Cache-Control', 'public, s-maxage=3600');
		res.setHeader('Content-Type', XML_CONTENT_TYPE);
		return res.status(200).send(capsXml());
	}

	// Fail closed on a deploy that forgot NEWZNAB_TOKEN_SECRET: without it no
	// guid can be minted and no grab can be read back, so the endpoint is
	// genuinely disabled rather than quietly serving ungrabbable items.
	if (!hasTokenSecret()) {
		return sendError(res, 200, 910, 'This function is not available');
	}

	try {
		if (isSearchType(t)) return await handleSearch(req, res, t);
		if (t === 'get') return await handleGrab(req, res);
		return sendError(res, 200, 202, 'No such function');
	} catch (error) {
		// A Next.js 500 is an HTML page, which an *arr logs as an unreachable
		// indexer. Say it in the protocol instead.
		console.error('Newznab endpoint failed:', error);
		return sendError(res, 200, 900, 'Unknown error');
	}
}

export default handler;
