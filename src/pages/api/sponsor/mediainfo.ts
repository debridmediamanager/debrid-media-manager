import { validateDmmApiKeyHeader } from '@/pages/api/zurg/auth';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { storedProbes, withContributedProbes } from '@/utils/torrentSnapshot';
import type { NextApiRequest, NextApiResponse } from 'next';

const MAX_HASHES = 100;
const INFO_HASH = /^[a-f0-9]{40}$/;

/**
 * The ffprobe output zurg instances have already sent DMM for each release hash,
 * file by file with the path and size it was taken of, so a sponsor's zurg can
 * skip probing what someone has probed before. Then the probes sponsors' apps
 * sent for single files (POST /api/sponsor/probes), for files zurg's snapshot
 * does not hold by size; one of those has only a name for its path, or none. A
 * hash with no stored probe is absent from the answer.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	if (!(await validateDmmApiKeyHeader(req, res))) return;

	const hashes = (req.body as { hashes?: unknown } | undefined)?.hashes;
	const wanted = Array.isArray(hashes)
		? hashes.map((h) => (typeof h === 'string' ? h.toLowerCase() : ''))
		: [];
	if (!wanted.length || wanted.length > MAX_HASHES || !wanted.every((h) => INFO_HASH.test(h))) {
		return res.status(400).json({
			error: `Expected {"hashes": [...]} with 1-${MAX_HASHES} 40-character info hashes`,
		});
	}

	try {
		const releases: Record<string, { files: ReturnType<typeof storedProbes> }> = {};
		const [snapshots, contributed] = await Promise.all([
			db.getSnapshotsByHashes(wanted),
			db.getContributedProbes(wanted),
		]);
		const snapshotFiles = new Map(snapshots.map((s) => [s.hash, storedProbes(s.payload)]));
		for (const hash of wanted) {
			const files = withContributedProbes(
				snapshotFiles.get(hash) ?? {},
				contributed.filter((row) => row.hash === hash)
			);
			if (Object.keys(files).length) releases[hash] = { files };
		}
		return res.status(200).json({ releases });
	} catch (error) {
		console.error('Failed to read stored media info', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.sponsorMediaInfo);
