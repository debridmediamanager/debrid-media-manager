import { validateDmmApiKeyHeader } from '@/pages/api/zurg/auth';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import type { NextApiRequest, NextApiResponse } from 'next';

const INFO_HASH = /^[a-fA-F0-9]{40}$/;

// A whole Real-Debrid library in a few calls: plexsim's catalog builder sends
// the hashes of every torrent it lists. 3,347 hashes is seven calls at 500.
const MAX_HASHES = 500;

/**
 * Which title each release hash is, by the mappings DMM already holds
 * (`identifyLibraryHashes`: zurg's HashImdb first, then the pages users added
 * releases from, with ScrapedVerdict keeps and trashes applied).
 *
 * Read-only, and gated on an active sponsor's DMM API key like the other
 * endpoints a self-hosted tool calls. A hash DMM has never seen is simply
 * absent from the answer: the caller falls back to matching the name.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	if (!(await validateDmmApiKeyHeader(req, res))) return;

	const hashes = (req.body as { hashes?: unknown } | undefined)?.hashes;
	if (
		!Array.isArray(hashes) ||
		hashes.length === 0 ||
		hashes.length > MAX_HASHES ||
		!hashes.every((hash) => typeof hash === 'string' && INFO_HASH.test(hash))
	) {
		return res.status(400).json({
			error: `Expected {"hashes": [...]} with 1-${MAX_HASHES} 40-character info hashes`,
		});
	}

	try {
		const identities = await repository.identifyLibraryHashes(hashes as string[]);
		return res.status(200).json({ identities: Object.fromEntries(identities) });
	} catch (error) {
		console.error('Failed to identify hashes', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.identifyHashes);
