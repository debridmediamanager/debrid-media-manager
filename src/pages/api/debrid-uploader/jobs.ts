import { orderedServersForNewJob, resolveJobServer } from '@/services/debridUploaderServers';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import type { NextApiRequest, NextApiResponse } from 'next';

// The debrid uploader service speaks plain HTTP with no CORS, so the browser can
// never call it directly; this route is the server-side hop, and it also spreads
// new jobs across the configured server pool.

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
		const server = await resolveJobServer(record.jobId, (j) => db.getDebridJobServer(j));
		if (!server) return false;
		const res = await fetch(`${server}/jobs/${record.jobId}`, {
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

	const { hash, imdbId, rdKey, tbKey, adKey, sizeBytes } = req.body ?? {};

	if (typeof hash !== 'string' || !/^[a-fA-F0-9]{40}$/.test(hash)) {
		return res.status(400).json({ error: 'hash must be a 40-char hex info hash' });
	}
	if (typeof imdbId !== 'string' || !/^tt\d+$/.test(imdbId)) {
		return res.status(400).json({ error: 'imdbId is required (format: tt1234567)' });
	}
	if (typeof rdKey !== 'string' || !rdKey) {
		return res.status(400).json({ error: 'rdKey is required' });
	}
	// At least one source key: TorBox and/or AllDebrid. The debrid service uses
	// whichever it finds the hash cached on.
	const tbSource = typeof tbKey === 'string' && tbKey ? tbKey : undefined;
	const adSource = typeof adKey === 'string' && adKey ? adKey : undefined;
	if (!tbSource && !adSource) {
		return res.status(400).json({ error: 'a tbKey or adKey source is required' });
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

	const body = JSON.stringify({
		input: `magnet:?xt=urn:btih:${originalHash}`,
		imdb_id: imdbId,
		rd_api_key: rdKey,
		...(tbSource ? { tb_api_key: tbSource } : {}),
		...(adSource ? { ad_api_key: adSource } : {}),
	});

	// Route by size so a big torrent never lands on an underpowered, capped host.
	const jobSize = typeof sizeBytes === 'number' && sizeBytes > 0 ? sizeBytes : undefined;

	// Try the round-robin-chosen server first; on a network failure fall through
	// to the others. A non-network error (e.g. 400) is deterministic, so return it.
	let lastNetworkError = false;
	for (const server of orderedServersForNewJob(jobSize)) {
		let response: Response;
		try {
			response = await fetch(`${server}/jobs`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body,
				signal: AbortSignal.timeout(30000),
			});
		} catch (error) {
			console.error(`Debrid uploader ${server} unreachable, trying next:`, error);
			lastNetworkError = true;
			continue;
		}

		const data = await response.json().catch(() => ({}));
		if (response.ok && data?.id) {
			await Promise.all([
				db
					.recordDebridTransferPending(originalHash, data.id, imdbId)
					.catch((e) => console.error('Recording pending transfer failed:', e)),
				db
					.recordDebridJobServer(data.id, server)
					.catch((e) => console.error('Recording job server failed:', e)),
			]);
		}
		return res.status(response.status).json(data);
	}

	return res.status(502).json({
		error: lastNetworkError ? 'All debrid uploader servers unreachable' : 'no server',
	});
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
