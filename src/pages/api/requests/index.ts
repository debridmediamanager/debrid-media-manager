import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { generateUserId } from '@/utils/castApiHelpers';
import { parseRequestInput, RequestValidationError, toPublicRequest } from '@/utils/contentRequest';
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

const DEFAULT_LIMIT = 25;
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
		const limit = clampLimit(req.query.limit);
		const offset = clampOffset(req.query.offset);
		try {
			// One extra row is fetched but never returned: its presence is how the
			// page's infinite scroll learns there is another page without a second
			// count query. A viewer's own open request is already on the board, so
			// it is marked `mine` in place rather than merged in from a second list
			// — merging broke pagination, since a `mine` row could land on any page.
			const rows = await db.listOpenContentRequests(limit + 1, offset);
			const hasMore = rows.length > limit;
			return res.status(200).json({
				requests: rows.slice(0, limit).map((row) => toPublicRequest(row, viewerId)),
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
