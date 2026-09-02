import {
	addHashToRdAccount,
	fetchNzb,
	getNzb2rdUrl,
	isCompleteOAuth,
	isValidImdbId,
	submitNzb,
} from '@/services/nzb2rd';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { safeNzbName } from '@/utils/nzbName';
import { isSponsorRequest } from '@/utils/requireSponsor';
import { safeReturnPath } from '@/utils/transferContext';
import type { NextApiRequest, NextApiResponse } from 'next';

// Is a recorded transfer still worth blocking a fresh submission? A completed
// one counts only while its torrent is still RD-cached (a pruned one should be
// re-fetchable); a pending one only while its job is still alive.
async function isTransferStillValid(record: {
	status: string;
	jobId: string;
	infoHash?: string;
}): Promise<boolean> {
	if (record.status === 'completed') {
		if (!record.infoHash) return false;
		const available = await db.checkAvailabilityByHashes([record.infoHash]);
		return available.length > 0;
	}
	try {
		const res = await fetch(`${getNzb2rdUrl()}/jobs/${encodeURIComponent(record.jobId)}`, {
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

// Send one Usenet release to nzb2rd, which fetches it off Usenet, rebuilds it
// as a webseed torrent and adds it to the caller's Real-Debrid account. The NZB
// is downloaded here rather than in the browser so the indexer key stays server
// side.
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { id, title, imdbId, rdKey, oauth, returnPath } = req.body ?? {};

	// The colon separates the indexer prefix from the native id (`ds:abc123`).
	if (typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(id)) {
		return res.status(400).json({ error: 'id must be an indexer result id' });
	}
	if (!isValidImdbId(imdbId)) {
		return res.status(400).json({ error: 'imdbId is required (format: tt1234567)' });
	}
	if (typeof rdKey !== 'string' || !rdKey) {
		return res.status(400).json({ error: 'rdKey is required' });
	}

	// Cross-user / cross-device dedup: a Usenet fetch is expensive (indexer grab
	// quota + block-account bytes), so never run the same release twice while an
	// earlier transfer is still good.
	try {
		const existing = await db.getNzb2rdTransfer(id);
		if (existing && (await isTransferStillValid(existing))) {
			// Already finished: RD has the content cached, so put it straight into
			// this caller's account instead of sending them off to find it.
			if (existing.status === 'completed' && existing.infoHash) {
				let added = false;
				try {
					await addHashToRdAccount(rdKey, existing.infoHash);
					added = true;
				} catch (error) {
					console.error('Adding a completed nzb2rd transfer to RD failed:', error);
				}
				return res.status(200).json({
					duplicate: 'completed',
					infoHash: existing.infoHash,
					jobId: existing.jobId,
					added,
				});
			}

			// Still running: park this caller so the completion path hands them the
			// torrent too, rather than letting one user's fetch benefit only them.
			// The credentials ride along for the same reason they go to nzb2rd: this
			// list is drained when the job completes, which is days later, and by
			// then `rdKey` has expired and the delivery silently fails.
			await db
				.addNzb2rdWaiter(id, rdKey, imdbId, isCompleteOAuth(oauth) ? oauth : null)
				.catch((e) => console.error('Queueing nzb2rd waiter failed:', e));
			return res.status(200).json({
				duplicate: 'in_progress',
				infoHash: null,
				jobId: existing.jobId,
				queued: true,
			});
		}
	} catch (error) {
		console.error('nzb2rd transfer dedup check failed (continuing):', error);
	}

	let nzbText: string;
	try {
		nzbText = await fetchNzb(id);
	} catch (error) {
		console.error('NZB download failed:', error);
		return res.status(502).json({ error: 'Could not download the NZB from the indexer' });
	}
	if (!nzbText.trim()) {
		return res.status(502).json({ error: 'The indexer returned an empty NZB' });
	}

	try {
		const { status, data } = await submitNzb({
			nzbText,
			nzbName: safeNzbName(typeof title === 'string' ? title : id),
			imdbId,
			rdKey,
			// Forwarded so nzb2rd can mint its own token when the job finally runs.
			// `rdKey` expires 24h after login and that queue is days deep, which is
			// what produced the `401 bad_token` failures on the Transfers page.
			oauth: isCompleteOAuth(oauth) ? oauth : null,
			// Sponsor perk: a place in nzb2rd's priority tier. Verified here
			// rather than trusted from the body — the browser only ever sends the
			// signed token, and this is the one place that checks its signature.
			priority: isSponsorRequest(req),
		});
		if (status < 300 && data?.id) {
			await Promise.all([
				db
					.recordNzb2rdTransferPending(
						id,
						data.id,
						imdbId,
						typeof title === 'string' ? title : undefined
					)
					.catch((e) => console.error('Recording pending nzb2rd transfer failed:', e)),
				// Keyed by job id, unlike the record above: the Transfers page knows a
				// job, and the release id it is keyed by cannot be looked up from one.
				db
					.recordTransferMeta({
						source: 'nzb2rd',
						jobId: data.id,
						imdbId,
						title: typeof title === 'string' ? title : undefined,
						returnPath: safeReturnPath(returnPath),
						releaseId: id,
					})
					.catch((e) => console.error('Recording transfer context failed:', e)),
			]);
		}
		return res.status(status).json(data);
	} catch (error) {
		console.error('nzb2rd submission failed:', error);
		return res.status(502).json({ error: 'nzb2rd service unreachable' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
