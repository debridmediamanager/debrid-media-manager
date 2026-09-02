import { orderedServersForNewJob, resolveJobServer } from '@/services/debridUploaderServers';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { isSponsorRequest } from '@/utils/requireSponsor';
import { safeReturnPath } from '@/utils/transferContext';
import { exceedsTransferSizeCap, MAX_TRANSFER_BYTES, tooLargeMessage } from '@/utils/transferSize';
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

// Add a completed rewritten torrent to the requesting user's RD account.
// The content is RD-cached (another user's job completed it), so this is instant.
async function addRewrittenToUserRd(rdKey: string, rewrittenHash: string): Promise<boolean> {
	try {
		const addRes = await fetch('https://app.real-debrid.com/rest/1.0/torrents/addMagnet', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${rdKey}`,
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: `magnet=${encodeURIComponent(`magnet:?xt=urn:btih:${rewrittenHash}`)}`,
			signal: AbortSignal.timeout(15000),
		});
		if (addRes.status !== 201) return false;
		const { id } = await addRes.json();
		await fetch(`https://app.real-debrid.com/rest/1.0/torrents/selectFiles/${id}`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${rdKey}`,
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: 'files=all',
			signal: AbortSignal.timeout(15000),
		});
		return true;
	} catch {
		return false;
	}
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { hash, imdbId, rdKey, tbKey, sizeBytes, title, returnPath } = req.body ?? {};

	if (typeof hash !== 'string' || !/^[a-fA-F0-9]{40}$/.test(hash)) {
		return res.status(400).json({ error: 'hash must be a 40-char hex info hash' });
	}
	if (typeof imdbId !== 'string' || !/^tt\d+$/.test(imdbId)) {
		return res.status(400).json({ error: 'imdbId is required (format: tt1234567)' });
	}
	if (typeof rdKey !== 'string' || !rdKey) {
		return res.status(400).json({ error: 'rdKey is required' });
	}
	// TorBox is the only cache source. AllDebrid was withdrawn on 2026-09-01 with
	// debrid01, the one uploader host whose IP AllDebrid permitted: `magnet/upload`
	// is the cache probe now that the read-only check is retired, so from any
	// remaining host it can only answer `NO_SERVER`. The UI stopped offering it
	// first, but this route kept accepting `adKey` from stale browser bundles and
	// turned a guaranteed refusal into the job's user-visible failure reason.
	const tbSource = typeof tbKey === 'string' && tbKey ? tbKey : undefined;
	if (!tbSource) {
		return res.status(400).json({ error: 'a tbKey source is required' });
	}

	const originalHash = hash.toLowerCase();

	// Cross-user / cross-device dedup: the localStorage guard only knows this
	// browser's jobs, so the authoritative "already transferred?" check lives here.
	// When a completed duplicate exists, also add the content to the requesting
	// user's RD account — another user's job put it there, so it's RD-cached and
	// the addMagnet is instant.
	try {
		const existing = await db.getDebridTransfer(originalHash);
		if (existing && (await isTransferStillValid(existing))) {
			let addedToRd = false;
			if (existing.status === 'completed' && existing.rewrittenHash) {
				addedToRd = await addRewrittenToUserRd(rdKey, existing.rewrittenHash);
			}
			return res.status(200).json({
				duplicate: existing.status === 'completed' ? 'completed' : 'in_progress',
				rewrittenHash: existing.rewrittenHash ?? null,
				jobId: existing.jobId,
				addedToRd,
			});
		}
	} catch (error) {
		console.error('Debrid transfer dedup check failed (continuing):', error);
	}

	// Route by size so a big torrent never lands on an underpowered, capped host.
	const jobSize = typeof sizeBytes === 'number' && sizeBytes > 0 ? sizeBytes : undefined;

	// Too large to be worth starting. Deliberately **after** the dedup check
	// above: a release transferred before the cap existed is already RD-cached
	// under its rewritten hash, and serving that costs one instant addMagnet and
	// no uploader bandwidth at all — refusing it would deny content for free.
	// This only stops a *new* transfer.
	//
	// The uploader enforces the same cap itself once it knows the real size, so
	// this is the early half of the decision rather than the load-bearing one —
	// which is why an unknown size is allowed through rather than guessed at.
	if (exceedsTransferSizeCap(jobSize)) {
		return res.status(413).json({
			error: tooLargeMessage(jobSize as number),
			sizeBytes: jobSize,
			maxBytes: MAX_TRANSFER_BYTES,
		});
	}

	const body = JSON.stringify({
		input: `magnet:?xt=urn:btih:${originalHash}`,
		imdb_id: imdbId,
		rd_api_key: rdKey,
		tb_api_key: tbSource,
		// Sponsor perk: a higher concurrent-job ceiling on the uploader, which
		// refuses over-limit submissions with a 429 rather than queueing them.
		// Verified here — the browser only ever sends the signed token, and this
		// is the one place that checks its signature.
		sponsor: isSponsorRequest(req),
	});

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
				// The page this was started from, so the Transfers page can label the
				// row and link back to the content from any device. The uploader
				// service records neither, and this used to live in localStorage.
				db
					.recordTransferMeta({
						source: 'debrid',
						jobId: data.id,
						imdbId,
						title: typeof title === 'string' ? title : undefined,
						returnPath: safeReturnPath(returnPath),
					})
					.catch((e) => console.error('Recording transfer context failed:', e)),
			]);
		}
		return res.status(response.status).json(data);
	}

	return res.status(502).json({
		error: lastNetworkError ? 'All debrid uploader servers unreachable' : 'no server',
	});
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
