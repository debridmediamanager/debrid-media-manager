import { sponsorOfDmmApiKeyHeader } from '@/pages/api/zurg/auth';
import { hasTokenSecret } from '@/services/newznab/opaqueId';
import { isStoreConfigured } from '@/services/newznab/store';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { parseHistory } from '@/services/wantedHistory';
import type { NextApiRequest, NextApiResponse } from 'next';

export const config = { api: { bodyParser: { sizeLimit: '256kb' } } };

/**
 * What zurg did for wanted titles: `{"items": [{"id", "seasons"?, "events": [...]}]}`,
 * at most 20 items and 200 events a call. Each event is a release it took and
 * confirmed (`grabbed`), turned down (`rejected`) or set aside later (`removed`), or
 * a search that ended with nothing (`failed`). `seasons` replaces a show's have/missing
 * snapshot. Answers `{ok, stored, unknown, want_nzb, refused?}`: how many events were new
 * (one resent under its item and `key` is not stored twice), the item ids no longer on the
 * list, the sha256s of grabbed NZBs DMM would like uploaded, and the events or snapshots
 * that did not read and were left out. Only a body that is not a report at all is a 400.
 * See docs/sponsor-api.md.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const sponsor = await sponsorOfDmmApiKeyHeader(req, res);
	if (!sponsor) return;
	if (
		!(await checkRateLimitFor(
			`sponsor:${sponsor.shortId}`,
			RATE_LIMIT_CONFIGS.sponsorWantedHistory,
			res
		))
	) {
		return res.status(429).json({ error: 'Rate limit exceeded' });
	}
	const parsed = parseHistory(req.body);
	if (typeof parsed === 'string') return res.status(400).json({ error: parsed });
	const { items, refused } = parsed;

	try {
		const owned = await db.ownedWanted(
			sponsor.shortId,
			items.map((item) => item.id)
		);
		const known = items.filter((item) => owned.has(item.id));
		const events = known.flatMap((item) => item.events);
		const stored = await db.recordWantedEvents(sponsor.shortId, owned, events);
		for (const item of known) {
			if (item.seasons && owned.get(item.id)?.kind === 'show') {
				await db.setWantedProgress(sponsor.shortId, item.id, item.seasons);
			}
		}

		// An NZB DMM served (`dmm_id`) is one it has; one it cannot store is not asked for.
		const candidates = [
			...new Set(
				events
					.filter((e) => e.kind === 'grabbed' && !e.torrent && e.nzb && !e.dmmId)
					.map((e) => e.nzb as string)
			),
		];
		const held =
			candidates.length && isStoreConfigured() && hasTokenSecret()
				? await db.heldWantedNzbs(candidates)
				: new Set(candidates);
		return res.status(200).json({
			ok: true,
			stored,
			unknown: items.filter((item) => !owned.has(item.id)).map((item) => item.id),
			want_nzb: candidates.filter((sha) => !held.has(sha)),
			// What did not read and was left out, the first 20; absent when all of it did.
			...(refused.length && { refused }),
		});
	} catch (error) {
		console.error('[sponsor/wanted/history] failed', error);
		return res.status(500).json({ error: 'Could not record the history' });
	}
}
