import { validateDmmApiKeyHeader } from '@/pages/api/zurg/auth';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { storedProbes } from '@/utils/torrentSnapshot';
import type { NextApiRequest, NextApiResponse } from 'next';

const MAX_HASHES = 100;
const INFO_HASH = /^[a-f0-9]{40}$/;

/**
 * The ffprobe output zurg instances have already sent DMM for each release hash,
 * file by file with the path and size it was taken of, so a sponsor's zurg can
 * skip probing what someone has probed before. A hash with no stored probe is
 * absent from the answer.
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
		for (const snapshot of await db.getSnapshotsByHashes(wanted)) {
			const files = storedProbes(snapshot.payload);
			if (Object.keys(files).length) releases[snapshot.hash] = { files };
		}
		return res.status(200).json({ releases });
	} catch (error) {
		console.error('Failed to read stored media info', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.sponsorMediaInfo);
