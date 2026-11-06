import { sponsorOfDmmApiKeyHeader } from '@/pages/api/zurg/auth';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { contributedProbe, type ContributedProbeRow } from '@/utils/torrentSnapshot';
import type { NextApiRequest, NextApiResponse } from 'next';

const MAX_PROBES = 100;

// Up to MAX_PROBES probes of up to 256 KB each, though a film's is about 10 KB.
export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };

/**
 * A sponsor's app sends the ffprobe output it took of single files of torrents:
 * `{"probes": [{"hash", "bytes", "name"?, "MediaInfo"}]}`, 1-100. /api/sponsor/mediainfo then answers
 * them to every sponsor, after zurg's own snapshots of the same releases. The first probe sent for
 * a file (hash and exact size) is kept: a later one is counted as `known`, so a post can neither
 * replace nor erase one. A probe that is refused is named by its place in the list, the rest kept.
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
			RATE_LIMIT_CONFIGS.sponsorProbes,
			res
		))
	) {
		return res.status(429).json({ error: 'Rate limit exceeded' });
	}

	const probes = (req.body as { probes?: unknown } | undefined)?.probes;
	if (!Array.isArray(probes) || probes.length === 0 || probes.length > MAX_PROBES) {
		return res
			.status(400)
			.json({ error: `Expected {"probes": [...]} with 1-${MAX_PROBES} probes` });
	}

	const rows: ContributedProbeRow[] = [];
	const rejected: { index: number; error: string }[] = [];
	const seen = new Set<string>();
	probes.forEach((raw, index) => {
		const result = contributedProbe(raw, sponsor.shortId);
		if ('error' in result) {
			rejected.push({ index, error: result.error });
			return;
		}
		const key = `${result.row.hash}:${result.row.bytes}`;
		if (seen.has(key)) {
			rejected.push({ index, error: 'the same file twice in one request' });
			return;
		}
		seen.add(key);
		rows.push(result.row);
	});

	try {
		const saved = rows.length ? await db.saveContributedProbes(rows) : 0;
		return res
			.status(200)
			.json({ saved, known: rows.length - saved, ...(rejected.length ? { rejected } : {}) });
	} catch (error) {
		console.error('Failed to save contributed probes', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
}
