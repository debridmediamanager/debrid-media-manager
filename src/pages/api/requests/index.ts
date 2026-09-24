import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { addHashToRd, alreadyOnRealDebrid } from '@/services/requestDelivery';
import { generateUserId } from '@/utils/castApiHelpers';
import { parseRequestInput, RequestValidationError, toPublicRequest } from '@/utils/contentRequest';
import { torboxCachedHashesReusing } from '@/utils/torboxCache';
import { exceedsTransferSizeCap, tooLargeMessage } from '@/utils/transferSize';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * The request board.
 *
 * `GET` lists what is open plus the caller's own asks; `POST` files one.
 *
 * A request exists because the uploader needs two credentials to move a
 * release — a Real-Debrid key for the destination and a TorBox or AllDebrid key
 * for the source — and a user with only Real-Debrid holds one of them. Filing a
 * request is how they leave their half where someone with the other half can
 * find it.
 */

/** Matches the Transfers page: the key is a header, never a query param. */
const RD_TOKEN_HEADER = 'x-rd-access-token';
/**
 * A fulfiller's TorBox key, sent so each row can say whether TorBox has it.
 * A header for the same reason as the RD key: nginx logs query strings.
 */
const TB_KEY_HEADER = 'x-tb-api-key';

const DEFAULT_LIMIT = 25;
/**
 * How much of the board the "only what TorBox can send" view reads. It filters
 * before paging, so it has to see the whole board rather than one page; 1,095
 * rows were open on 2026-09-24.
 */
const SERVABLE_SCAN = 3000;
const MAX_LIMIT = 100;

function clampLimit(raw: unknown): number {
	if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_LIMIT;
	const value = Number(raw);
	if (!Number.isFinite(value)) return DEFAULT_LIMIT;
	return Math.min(Math.max(Math.trunc(value), 1), MAX_LIMIT);
}

function clampOffset(raw: unknown): number {
	const value = Array.isArray(raw) ? raw[0] : raw;
	const n = typeof value === 'string' ? Number(value) : 0;
	if (!Number.isFinite(n) || n < 0) return 0;
	return Math.trunc(n);
}

function readToken(req: NextApiRequest): string | null {
	const header = req.headers[RD_TOKEN_HEADER];
	const token = Array.isArray(header) ? header[0] : header;
	return typeof token === 'string' && token.trim() !== '' ? token.trim() : null;
}

/**
 * Who is calling, as the stable DMM id.
 *
 * Anonymous is allowed on `GET` — the board is readable without an account, and
 * a viewer with no id simply gets no rows marked `mine`. A bad token is treated
 * the same way rather than as an error: a browsing user whose Real-Debrid
 * session has lapsed should still see the board.
 */
function readTbKey(req: NextApiRequest): string | null {
	const header = req.headers[TB_KEY_HEADER];
	const key = Array.isArray(header) ? header[0] : header;
	return typeof key === 'string' && key.trim() !== '' ? key.trim() : null;
}

async function viewerIdOf(req: NextApiRequest): Promise<string | null> {
	const token = readToken(req);
	if (!token) return null;
	try {
		return await generateUserId(token);
	} catch {
		return null;
	}
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method === 'GET') {
		const viewerId = await viewerIdOf(req);

		// `?mine=1`: the caller's own asks in every state, newest first. The
		// board only lists what is still open, so this is the one place an asker
		// learns that a request was sent, failed, or is on its way.
		if (req.query.mine === '1') {
			if (!viewerId) {
				return res.status(401).json({ error: 'A Real-Debrid session is required' });
			}
			try {
				const rows = await db.listContentRequestsFor(viewerId, MAX_LIMIT);
				return res.status(200).json({
					requests: rows.map((row) => toPublicRequest(row, viewerId)),
					authenticated: true,
					hasMore: false,
				});
			} catch (error) {
				console.error('Listing own content requests failed:', error);
				return res.status(500).json({ error: 'Failed to list requests' });
			}
		}

		const limit = clampLimit(req.query.limit);
		const offset = clampOffset(req.query.offset);
		const tbKey = readTbKey(req);

		// `?servable=1`: only what TorBox has cached, across the whole board.
		// The board is oldest-first and mostly releases TorBox does not have, so
		// on 2026-09-24 nothing filed after 09-15 had been reached. Only these
		// rows can be sent by anyone, and here they come first.
		if (req.query.servable === '1') {
			if (!tbKey) return res.status(400).json({ error: 'a TorBox key is required' });
			try {
				const rows = await db.listOpenContentRequests(SERVABLE_SCAN, 0);
				const cached = await torboxCachedHashesReusing(
					tbKey,
					rows.map((row) => row.hash)
				);
				if (!cached) {
					return res.status(503).json({ error: 'TorBox did not answer, try again' });
				}
				const servable = rows.filter((row) => cached.has(row.hash));
				return res.status(200).json({
					requests: servable
						.slice(offset, offset + limit)
						.map((row) => toPublicRequest(row, viewerId, cached)),
					authenticated: viewerId !== null,
					hasMore: servable.length > offset + limit,
				});
			} catch (error) {
				console.error('Listing servable content requests failed:', error);
				return res.status(500).json({ error: 'Failed to list requests' });
			}
		}

		try {
			// One extra row is fetched but never returned: its presence is how the
			// page's infinite scroll learns there is another page without a second
			// count query. A viewer's own open request is already on the board, so
			// it is marked `mine` in place rather than merged in from a second list
			// — merging broke pagination, since a `mine` row could land on any page.
			const rows = await db.listOpenContentRequests(limit + 1, offset);
			const hasMore = rows.length > limit;
			const page = rows.slice(0, limit);
			// Asked here rather than from the browser so the answer is the same
			// one the fulfil route will act on, and arrives with the rows.
			const tbCached =
				tbKey && page.length > 0
					? await torboxCachedHashesReusing(
							tbKey,
							page.map((row) => row.hash)
						)
					: null;
			return res.status(200).json({
				requests: page.map((row) => toPublicRequest(row, viewerId, tbCached)),
				authenticated: viewerId !== null,
				hasMore,
			});
		} catch (error) {
			console.error('Listing content requests failed:', error);
			return res.status(500).json({ error: 'Failed to list requests' });
		}
	}

	if (req.method === 'POST') {
		const token = readToken(req);
		if (!token) {
			return res.status(401).json({ error: 'A Real-Debrid session is required to request' });
		}

		let requesterId: string;
		try {
			requesterId = await generateUserId(token);
		} catch {
			return res.status(401).json({ error: 'Real-Debrid session is not valid' });
		}

		let input;
		try {
			input = parseRequestInput(req.body);
		} catch (error) {
			if (error instanceof RequestValidationError) {
				return res.status(400).json({ error: error.message });
			}
			throw error;
		}

		// Too big for any transfer, so nobody could ever fulfil it. Refused here
		// the same way the direct route refuses it.
		if (exceedsTransferSizeCap(input.sizeBytes)) {
			return res.status(413).json({ error: tooLargeMessage(input.sizeBytes as number) });
		}

		// Nothing to ask for when Real-Debrid already has it: add it now with the
		// asker's own session. 72 open requests on 2026-09-24 were for releases
		// RD had cached. A failed add files the request as usual.
		try {
			const onRd = (await alreadyOnRealDebrid([input.hash])).get(input.hash);
			if (onRd && (await addHashToRd(token, onRd))) {
				return res.status(200).json({ delivered: true });
			}
		} catch (error) {
			console.error('Checking Real-Debrid before filing a request failed:', error);
		}

		try {
			const row = await db.createContentRequest({ ...input, requesterId });
			// 200 rather than 201 because the upsert makes this idempotent: asking
			// twice returns the existing row rather than creating a second one.
			return res.status(200).json({ request: toPublicRequest(row, requesterId) });
		} catch (error) {
			console.error('Creating a content request failed:', error);
			return res.status(500).json({ error: 'Failed to file the request' });
		}
	}

	res.setHeader('Allow', 'GET, POST');
	return res.status(405).json({ error: 'Method not allowed' });
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
