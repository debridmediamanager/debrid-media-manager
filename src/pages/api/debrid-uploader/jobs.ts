import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import type { NextApiRequest, NextApiResponse } from 'next';

// The debrid uploader service on debrid02 speaks plain HTTP with no CORS, so the
// browser can never call it directly; this route is the server-side hop.
const DEBRID_UPLOADER_URL = process.env.DEBRID_UPLOADER_URL || 'http://138.201.246.20:3100';

// Is a mapped transfer still worth blocking a fresh submission? A completed one
// counts only while its rewritten torrent is still RD-cached (a pruned one
// should be re-transferable); a pending one only while its job is still alive.
async function isTransferStillValid(record: {
	status: string;
	jobId: string;
	rewrittenHash?: string;
}): Promise<boolean> {
	if (record.status === 'completed') {
		if (!record.rewrittenHash) return false;
		const available = await db.checkAvailabilityByHashes([record.rewrittenHash]);
		return available.length > 0;
	}
	// pending: alive unless the referenced job has failed or vanished
	try {
		const res = await fetch(`${DEBRID_UPLOADER_URL}/jobs/${record.jobId}`, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(10000),
		});
		if (res.status === 404) return false;
		const job = await res.json();
		return job?.status !== 'failed';
	} catch {
		return false; // can't confirm it's alive — let the resubmit through
	}
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { hash, imdbId, rdKey, tbKey } = req.body ?? {};

	if (typeof hash !== 'string' || !/^[a-fA-F0-9]{40}$/.test(hash)) {
		return res.status(400).json({ error: 'hash must be a 40-char hex info hash' });
	}
	if (typeof imdbId !== 'string' || !/^tt\d+$/.test(imdbId)) {
		return res.status(400).json({ error: 'imdbId is required (format: tt1234567)' });
	}
	if (typeof rdKey !== 'string' || !rdKey) {
		return res.status(400).json({ error: 'rdKey is required' });
	}
	if (typeof tbKey !== 'string' || !tbKey) {
		return res.status(400).json({ error: 'tbKey is required' });
	}

	const originalHash = hash.toLowerCase();

	// Cross-user / cross-device dedup: the localStorage guard only knows this
	// browser's jobs, so the authoritative "already transferred?" check lives here.
	try {
		const existing = await db.getDebridTransfer(originalHash);
		if (existing && (await isTransferStillValid(existing))) {
			return res.status(200).json({
				duplicate: existing.status === 'completed' ? 'completed' : 'in_progress',
				rewrittenHash: existing.rewrittenHash ?? null,
				jobId: existing.jobId,
			});
		}
	} catch (error) {
		console.error('Debrid transfer dedup check failed (continuing):', error);
	}

	try {
		const response = await fetch(`${DEBRID_UPLOADER_URL}/jobs`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				input: `magnet:?xt=urn:btih:${originalHash}`,
				imdb_id: imdbId,
				rd_api_key: rdKey,
				tb_api_key: tbKey,
			}),
			signal: AbortSignal.timeout(30000),
		});
		const data = await response.json();

		if (response.ok && data?.id) {
			try {
				await db.recordDebridTransferPending(originalHash, data.id, imdbId);
			} catch (error) {
				console.error('Recording pending transfer failed (non-fatal):', error);
			}
		}

		return res.status(response.status).json(data);
	} catch (error) {
		console.error('Debrid uploader job creation failed:', error);
		return res.status(502).json({ error: 'Debrid uploader service unreachable' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
