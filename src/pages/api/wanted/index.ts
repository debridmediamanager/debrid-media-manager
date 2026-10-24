import { MAX_WANTED_ITEMS, type WantedItemRow } from '@/services/database/wantedItems';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { requireSponsor } from '@/utils/requireSponsor';
import type { NextApiRequest, NextApiResponse } from 'next';

const IMDB_ID = /^tt\d{7,}$/;

export interface WantedItemResponse {
	id: string;
	imdbId: string;
	kind: 'movie' | 'show';
	title: string;
	seasons: number[] | null;
	createdAt: string;
	fulfilledAt: string | null;
	lastPolledAt: string | null;
}

const toResponse = (row: WantedItemRow): WantedItemResponse => ({
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
 * `/api/sponsor/wanted`: GET lists it, POST `{imdbId, kind, title, seasons?}`
 * adds a title or replaces its seasons, DELETE `?imdbId=` removes one.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const payload = await requireSponsor(req, res);
	if (!payload) return;
	if (!(await checkRateLimitFor(`wanted:${payload.shortId}`, RATE_LIMIT_CONFIGS.wanted, res))) {
		return res.status(429).json({ error: 'Rate limit exceeded' });
	}

	try {
		if (req.method === 'GET') {
			const items = await db.listWanted(payload.shortId);
			return res.status(200).json({ items: items.map(toResponse) });
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
				return res
					.status(409)
					.json({ error: `Your wanted list is full (${MAX_WANTED_ITEMS} titles)` });
			}
			return res.status(200).json({ item: toResponse(row) });
		}

		if (req.method === 'DELETE') {
			const imdbId = typeof req.query.imdbId === 'string' ? req.query.imdbId : '';
			if (!IMDB_ID.test(imdbId)) {
				return res.status(400).json({ error: 'Expected ?imdbId=tt…' });
			}
			await db.unwant(payload.shortId, imdbId);
			return res.status(200).json({ ok: true });
		}

		res.setHeader('Allow', 'GET, POST, DELETE');
		return res.status(405).json({ error: 'Method not allowed' });
	} catch (error) {
		console.error('[wanted] failed', error);
		return res.status(500).json({ error: 'Could not update the wanted list' });
	}
}
