import type { WantedEventKind, WantedSeasonProgress } from '@/services/database/wantedEvents';
import { encryptReleaseId, hasTokenSecret } from '@/services/newznab/opaqueId';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { requireSponsor } from '@/utils/requireSponsor';
import type { NextApiRequest, NextApiResponse } from 'next';

const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One event as zurg reported it; `reason`, `detail`, `release`, `hash` and `nzb` are `""` where it said nothing. */
export interface WantedHistoryEvent {
	at: string;
	kind: WantedEventKind;
	reason: string;
	detail: string;
	release: string;
	torrent: boolean;
	hash: string;
	nzb: string;
	dmm_id?: string;
	size?: number;
	posted?: string;
	season?: number;
	episode?: number;
	pack: boolean;
	resolution: string;
}

export interface WantedHistoryResponse {
	seasons: WantedSeasonProgress[];
	events: WantedHistoryEvent[];
}

/**
 * What the signed-in sponsor's zurg reported for one wanted title: `?id=<item id>`
 * answers `{seasons, events}`, the show's have/missing snapshot and its newest 200
 * events, newest first. 404 for an id not on their list.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const payload = await requireSponsor(req, res);
	if (!payload) return;
	if (
		!(await checkRateLimitFor(
			`wantedHistory:${payload.shortId}`,
			RATE_LIMIT_CONFIGS.wanted,
			res
		))
	) {
		return res.status(429).json({ error: 'Rate limit exceeded' });
	}
	const id = req.query.id;
	if (typeof id !== 'string' || !ITEM_ID.test(id)) {
		return res.status(400).json({ error: 'Expected ?id=<wanted item id>' });
	}
	try {
		const history = await db.wantedHistory(payload.shortId, id);
		if (!history) return res.status(404).json({ error: 'Not on your wanted list' });
		const body: WantedHistoryResponse = {
			seasons: history.seasons,
			events: history.events.map((e) => {
				// Stored as the release id it named, which names an upstream: only the token goes out.
				const split = e.dmmId?.indexOf(':') ?? -1;
				return {
					at: e.at.toISOString(),
					kind: e.kind,
					reason: e.reason,
					detail: e.detail,
					release: e.release,
					torrent: e.torrent,
					hash: e.hash ?? '',
					nzb: e.nzb ?? '',
					...(e.dmmId &&
						split > 0 &&
						hasTokenSecret() && {
							dmm_id: encryptReleaseId(
								e.dmmId.slice(0, split),
								e.dmmId.slice(split + 1)
							),
						}),
					...(e.size !== null && { size: e.size }),
					...(e.posted && { posted: e.posted.toISOString() }),
					...(e.season !== null && { season: e.season }),
					...(e.episode !== null && { episode: e.episode }),
					pack: e.pack,
					resolution: e.resolution,
				};
			}),
		};
		res.setHeader('Cache-Control', 'private, no-store');
		return res.status(200).json(body);
	} catch (error) {
		console.error('[wanted/history] failed', error);
		return res.status(500).json({ error: 'Could not read the history' });
	}
}
