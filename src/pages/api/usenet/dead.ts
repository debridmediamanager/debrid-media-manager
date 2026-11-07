import { sponsorOfDmmApiKeyHeader } from '@/pages/api/zurg/auth';
import type { UsenetDeadSource } from '@/services/database';
import { decryptReleaseId } from '@/services/newznab/opaqueId';
import { nativeReleaseId, qualifyReleaseId } from '@/services/nzb2rd';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { hasInternalSecret } from '@/utils/internalAuth';
import type { NextApiRequest, NextApiResponse } from 'next';

const MAX_IDS = 50;
/** `prefix:nativeId`, in the alphabet /api/nzb2rd/download takes. */
const QUALIFIED_ID = /^[A-Za-z0-9]+:[A-Za-z0-9._:-]+$/;
/** A Newznab grab token (base64url), as `x-dmm-id` and `x-dmm-alternates` name a posting. */
const TOKEN = /^[A-Za-z0-9_-]+$/;

/** The qualified, lowercased id a report names, or null for one that names nothing. */
function postingOf(raw: unknown): string | null {
	if (typeof raw !== 'string' || raw.length > 128) return null;
	if (QUALIFIED_ID.test(raw)) return raw.toLowerCase();
	const token = TOKEN.test(raw) ? decryptReleaseId(raw) : null;
	return token
		? qualifyReleaseId(token.prefix, nativeReleaseId(token.nativeId)).toLowerCase()
		: null;
}

/**
 * Postings a downloader found without their articles: `{"ids": [...]}`, 1-50, each
 * a qualified release id (`ds:abc123`) or the grab token an NZB named it by.
 * Answers `{"marked": n}`, the distinct postings marked. For 30 days `orderCopies`
 * then hands out each one's other postings first, wherever DMM serves or sends it.
 *
 * nzb2rd reports with `Authorization: Bearer <METADATA_API_SECRET>`, the secret it
 * already holds for the metadata API; a sponsor's zurg with its DMM API key in
 * `x-api-key`. A report only moves a posting to the back of its release's list,
 * never out of it, so a wrong one costs a fallback, not a download.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	let source: UsenetDeadSource = 'nzb2rd';
	let budget = 'internal';
	if (!hasInternalSecret(req, process.env.METADATA_API_SECRET)) {
		const sponsor = await sponsorOfDmmApiKeyHeader(req, res);
		if (!sponsor) return;
		source = 'zurg';
		budget = `sponsor:${sponsor.shortId}`;
	}
	if (!(await checkRateLimitFor(budget, RATE_LIMIT_CONFIGS.usenetDead, res))) {
		return res.status(429).json({ error: 'Rate limit exceeded' });
	}

	const ids = (req.body as { ids?: unknown } | undefined)?.ids;
	if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) {
		return res
			.status(400)
			.json({ error: `Expected {"ids": [...]} with 1-${MAX_IDS} release ids` });
	}
	const postings = ids.map(postingOf);
	const bad = postings.findIndex((posting) => posting === null);
	if (bad !== -1) {
		return res.status(400).json({ error: `ids[${bad}] is not a release id or grab token` });
	}

	const unique = [...new Set(postings as string[])];
	try {
		await db.recordUsenetDead(unique, source);
	} catch (error) {
		console.error('Recording dead Usenet postings failed:', error);
		return res.status(500).json({ error: 'Could not record the report' });
	}
	return res.status(200).json({ marked: unique.length });
}
