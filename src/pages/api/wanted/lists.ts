import type { WantedListRow } from '@/services/database/wantedLists';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import {
	LIST_URL_HELP,
	ListUnreadable,
	parseListUrl,
	syncWantedList,
	type ListSyncResult,
} from '@/services/wantedLists';
import { requireSponsor } from '@/utils/requireSponsor';
import type { NextApiRequest, NextApiResponse } from 'next';

export interface WantedListResponse {
	id: string;
	url: string;
	name: string;
	/** Titles on the list at the last read. */
	count: number;
	/** Titles it has put on the wanted list so far. */
	added: number;
	createdAt: string;
	syncedAt: string | null;
	error: string | null;
}

export interface FollowListResponse extends ListSyncResult {
	list: WantedListResponse;
}

const toResponse = (row: WantedListRow): WantedListResponse => ({
	id: row.id,
	url: row.url,
	name: row.name,
	count: row.seen.length,
	added: row.added,
	createdAt: row.createdAt.toISOString(),
	syncedAt: row.syncedAt?.toISOString() ?? null,
	error: row.error,
});

/**
 * The Trakt and MDBList lists the signed-in sponsor follows: GET lists them,
 * POST `{url}` follows one and reads it at once, or reads again one already
 * followed, DELETE `?id=` unfollows (the titles it added stay wanted).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const payload = await requireSponsor(req, res);
	if (!payload) return;
	const limit =
		req.method === 'POST' ? RATE_LIMIT_CONFIGS.wantedLists : RATE_LIMIT_CONFIGS.wanted;
	if (!(await checkRateLimitFor(`${limit.name}:${payload.shortId}`, limit, res))) {
		return res.status(429).json({ error: 'Rate limit exceeded' });
	}

	try {
		if (req.method === 'GET') {
			const lists = await db.listWantedLists(payload.shortId);
			return res.status(200).json({ lists: lists.map(toResponse) });
		}

		if (req.method === 'POST') {
			const { url } = (req.body ?? {}) as Record<string, unknown>;
			const parsed = typeof url === 'string' && url.length <= 512 ? parseListUrl(url) : null;
			if (!parsed) return res.status(400).json({ error: LIST_URL_HELP });
			const { row, created } = await db.followWantedList(
				payload.shortId,
				parsed.url,
				parsed.label
			);
			let result: ListSyncResult;
			try {
				result = await syncWantedList(row);
			} catch (error) {
				// A list that cannot be read is not followed; one already followed keeps its error.
				if (created) await db.unfollowWantedList(payload.shortId, row.id);
				if (error instanceof ListUnreadable) {
					return res.status(created ? 400 : 502).json({ error: error.message });
				}
				throw error;
			}
			const list = (await db.listWantedLists(payload.shortId)).find((l) => l.id === row.id);
			const body: FollowListResponse = { ...result, list: toResponse(list ?? row) };
			return res.status(200).json(body);
		}

		if (req.method === 'DELETE') {
			const id = typeof req.query.id === 'string' ? req.query.id : '';
			if (!id) return res.status(400).json({ error: 'Expected ?id=' });
			await db.unfollowWantedList(payload.shortId, id);
			return res.status(200).json({ ok: true });
		}

		res.setHeader('Allow', 'GET, POST, DELETE');
		return res.status(405).json({ error: 'Method not allowed' });
	} catch (error) {
		console.error('[wanted/lists] failed', error);
		return res.status(500).json({ error: 'Could not update the lists you follow' });
	}
}
