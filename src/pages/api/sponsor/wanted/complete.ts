import { sponsorOfDmmApiKeyHeader } from '@/pages/api/zurg/auth';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import type { NextApiRequest, NextApiResponse } from 'next';

const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESOLUTIONS = ['', '480p', '720p', '1080p', '2160p'];
const UPGRADES = ['720p', '1080p', '2160p'];

/**
 * zurg's acknowledgement that it fetched a wanted title: `{"id": "<item id>"}`,
 * optionally with what it took (`release`, `grab`, `torrent`, `resolution`) and
 * `upgrade_to`, a resolution it still wants. Safe to repeat; the first date
 * stands, and what zurg took is replaced each time, so `{"id"}` alone, as older
 * zurgs send, ends an upgrade wish. A film is then left off the list zurg reads
 * unless it wants an upgrade; a show stays on it. 404 for an id that is not
 * this sponsor's, which includes one the sponsor removed in the meantime.
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
			RATE_LIMIT_CONFIGS.sponsorWanted,
			res
		))
	) {
		return res.status(429).json({ error: 'Rate limit exceeded' });
	}
	const {
		id,
		release = '',
		grab = '',
		torrent = false,
		resolution = '',
		upgrade_to: upgradeTo,
	} = (req.body ?? {}) as Record<string, unknown>;
	if (typeof id !== 'string' || !ITEM_ID.test(id)) {
		return res.status(400).json({ error: 'Expected {"id": "<wanted item id>"}' });
	}
	const refuse = (error: string) => res.status(400).json({ error });
	if (typeof release !== 'string' || release.length > 512) {
		return refuse('"release" must be a string of at most 512 characters');
	}
	if (typeof grab !== 'string' || grab.length > 64) {
		return refuse('"grab" must be a string of at most 64 characters');
	}
	if (typeof torrent !== 'boolean') return refuse('"torrent" must be true or false');
	if (typeof resolution !== 'string' || !RESOLUTIONS.includes(resolution)) {
		return refuse('"resolution" must be "", "480p", "720p", "1080p" or "2160p"');
	}
	if (
		upgradeTo !== undefined &&
		(typeof upgradeTo !== 'string' || !UPGRADES.includes(upgradeTo) || !resolution)
	) {
		return refuse('"upgrade_to" must be "720p", "1080p" or "2160p", with a "resolution"');
	}

	try {
		const fulfilled = {
			release,
			grab,
			torrent,
			resolution,
			...(upgradeTo ? { upgradeTo } : {}),
		};
		if (!(await db.markWantedFulfilled(sponsor.shortId, id, fulfilled))) {
			return res.status(404).json({ error: 'Not on this wanted list' });
		}
		return res.status(200).json({ ok: true });
	} catch (error) {
		console.error('[sponsor/wanted/complete] failed', error);
		return res.status(500).json({ error: 'Could not record the acknowledgement' });
	}
}
