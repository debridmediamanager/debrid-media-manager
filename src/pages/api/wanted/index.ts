import {
	MAX_WANTED_ITEMS,
	MAX_WANTED_ROWS,
	type WantedFulfilled,
	type WantedItemRow,
	type WantedPin,
	type WantedTakes,
} from '@/services/database/wantedItems';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { requireSponsor } from '@/utils/requireSponsor';
import type { NextApiRequest, NextApiResponse } from 'next';

const IMDB_ID = /^tt\d{7,}$/;

export const WANTED_FULL = `Your wanted list is full: ${MAX_WANTED_ITEMS.toLocaleString('en-US')} titles still to fetch, or ${MAX_WANTED_ROWS.toLocaleString('en-US')} in all. Films zurg has fetched do not count toward the first.`;

export interface WantedItemResponse {
	id: string;
	imdbId: string;
	kind: 'movie' | 'show';
	title: string;
	seasons: number[] | null;
	createdAt: string;
	fulfilledAt: string | null;
	fulfilled: WantedFulfilled | null;
	lastPolledAt: string | null;
	/** Releases picked by "Send to zurg"; absent when none. */
	pins?: WantedPin[];
	/** A show's episodes held and missing per season, once zurg reported them. */
	progress?: WantedItemRow['progress'];
}

/** GET's answer for the whole list: the rows, when zurg last read it and what it takes. */
export interface WantedListResponse {
	items: WantedItemResponse[];
	lastPolledAt: string | null;
	takes: WantedTakes[] | null;
}

export const toResponse = (row: WantedItemRow): WantedItemResponse => ({
	...row,
	createdAt: row.createdAt.toISOString(),
	fulfilledAt: row.fulfilledAt?.toISOString() ?? null,
	lastPolledAt: row.lastPolledAt?.toISOString() ?? null,
});

/** `seasons` absent or null wants every season; otherwise 1-200 distinct season numbers. */
function parseSeasons(raw: unknown): number[] | null | undefined {
	if (raw == null) return null;
	if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) return undefined;
	if (!raw.every((n) => Number.isInteger(n) && n >= 1 && n <= 9999)) return undefined;
	return [...new Set(raw as number[])].sort((a, b) => a - b);
}

/**
 * The signed-in sponsor's wanted list, which their zurg reads from
 * `/api/sponsor/wanted`: GET lists it with when zurg last read it (`?imdbId=` lists
 * just that title, for a title page's button), POST `{imdbId, kind, title, seasons?}`
 * adds a title or replaces its seasons, DELETE `?imdbId=` removes one and
 * DELETE `{imdbIds: [...]}` several at once.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const payload = await requireSponsor(req, res);
	if (!payload) return;
	if (!(await checkRateLimitFor(`wanted:${payload.shortId}`, RATE_LIMIT_CONFIGS.wanted, res))) {
		return res.status(429).json({ error: 'Rate limit exceeded' });
	}

	try {
		if (req.method === 'GET') {
			const one = typeof req.query.imdbId === 'string' ? req.query.imdbId : undefined;
			if (one !== undefined && !IMDB_ID.test(one)) {
				return res.status(400).json({ error: 'Expected ?imdbId=tt…' });
			}
			const items = (await db.listWanted(payload.shortId, one)).map(toResponse);
			if (one) return res.status(200).json({ items });
			// Read beside the rows, so a list zurg reads while it is empty says so too.
			// `takes` is what that zurg said it can take (`nzb`, `torrent`), null when it
			// did not say: the Easynews rows offer Send to zurg only where an NZB plays.
			const [polled, takes] = await Promise.all([
				db.wantedPolledAt(payload.shortId),
				db.wantedTakes(payload.shortId),
			]);
			return res
				.status(200)
				.json({ items, lastPolledAt: polled?.toISOString() ?? null, takes });
		}

		if (req.method === 'POST') {
			const {
				imdbId,
				kind,
				title,
				seasons: rawSeasons,
			} = (req.body ?? {}) as Record<string, unknown>;
			const seasons = parseSeasons(rawSeasons);
			if (
				typeof imdbId !== 'string' ||
				!IMDB_ID.test(imdbId) ||
				(kind !== 'movie' && kind !== 'show') ||
				typeof title !== 'string' ||
				!title.trim() ||
				title.length > 512 ||
				seasons === undefined ||
				(kind === 'movie' && seasons !== null)
			) {
				return res.status(400).json({
					error: 'Expected {"imdbId": "tt…", "kind": "movie"|"show", "title": string, "seasons"?: [numbers] (shows only)}',
				});
			}
			const row = await db.want(payload.shortId, {
				imdbId,
				kind,
				title: title.trim(),
				seasons,
			});
			if (!row) {
				return res.status(409).json({ error: WANTED_FULL });
			}
			return res.status(200).json({ item: toResponse(row) });
		}

		if (req.method === 'DELETE') {
			const { imdbIds: rawIds } = (req.body ?? {}) as Record<string, unknown>;
			const imdbIds = typeof req.query.imdbId === 'string' ? [req.query.imdbId] : rawIds;
			if (
				!Array.isArray(imdbIds) ||
				imdbIds.length === 0 ||
				imdbIds.length > MAX_WANTED_ITEMS ||
				!imdbIds.every((id) => typeof id === 'string' && IMDB_ID.test(id))
			) {
				return res
					.status(400)
					.json({ error: 'Expected ?imdbId=tt… or {"imdbIds": ["tt…", …]}' });
			}
			const removed = await db.unwant(payload.shortId, ...imdbIds);
			return res.status(200).json({ ok: true, removed });
		}

		res.setHeader('Allow', 'GET, POST, DELETE');
		return res.status(405).json({ error: 'Method not allowed' });
	} catch (error) {
		console.error('[wanted] failed', error);
		return res.status(500).json({ error: 'Could not update the wanted list' });
	}
}
