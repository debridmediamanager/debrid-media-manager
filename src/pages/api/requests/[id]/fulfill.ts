import { isTransferStillValid } from '@/services/debridTransferValidity';
import { orderedServersForNewJob } from '@/services/debridUploaderServers';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { addHashToRd, alreadyOnRealDebrid, mintRequesterToken } from '@/services/requestDelivery';
import { generateUserId } from '@/utils/castApiHelpers';
import { canClaim, pickSourceKeys, RequestValidationError } from '@/utils/contentRequest';
import { torboxCachedHashes } from '@/utils/torboxCache';
import { FREE_TORBOX_PLAN_MESSAGE, isFreeTorBoxPlan } from '@/utils/torboxPlan';
import { exceedsTransferSizeCap, tooLargeMessage } from '@/utils/transferSize';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Fulfil somebody else's request.
 *
 * The caller brings the half the asker lacks — a TorBox or AllDebrid account
 * with the release cached — and the asker's stored Real-Debrid credentials
 * supply the other half. The uploader has always accepted a destination key and
 * a source key without caring whether they belong to the same person, so this
 * route is the matchmaking, not a new capability.
 *
 * The fulfiller's key is passed straight through and never stored here. It
 * lives on the uploader host only for the life of the job, which is what
 * `clearJobSecrets` on the debrid side now guarantees.
 */

const RD_TOKEN_HEADER = 'x-rd-access-token';

function readToken(req: NextApiRequest): string | null {
	const header = req.headers[RD_TOKEN_HEADER];
	const token = Array.isArray(header) ? header[0] : header;
	return typeof token === 'string' && token.trim() !== '' ? token.trim() : null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const id = req.query.id;
	if (typeof id !== 'string' || id === '') {
		return res.status(400).json({ error: 'request id is required' });
	}

	const token = readToken(req);
	if (!token) {
		return res.status(401).json({ error: 'A Real-Debrid session is required to fulfil' });
	}

	let fulfillerId: string;
	try {
		fulfillerId = await generateUserId(token);
	} catch {
		return res.status(401).json({ error: 'Real-Debrid session is not valid' });
	}

	let sourceKeys: { tb_api_key: string };
	try {
		const { tbKey } = (req.body ?? {}) as { tbKey?: string };
		sourceKeys = pickSourceKeys({ torboxApiKey: tbKey });
	} catch (error) {
		if (error instanceof RequestValidationError) {
			return res.status(400).json({ error: error.message });
		}
		throw error;
	}

	const request = await db.getContentRequest(id);
	if (!request) return res.status(404).json({ error: 'request not found' });

	const verdict = canClaim(request, fulfillerId);
	if (!verdict.ok) return res.status(verdict.code).json({ error: verdict.reason });

	// Already on Real-Debrid, either cached there all along or put there by an
	// earlier transfer: add it to the asker's account and spend nobody's TorBox.
	// Falls through to a normal fulfil if the add does not go through.
	const onRd = (await alreadyOnRealDebrid([request.hash]).catch(() => new Map())).get(
		request.hash
	);
	if (onRd) {
		const token = await mintRequesterToken(request.requesterId);
		if (token && (await addHashToRd(token, onRd))) {
			await db.markContentRequestDelivered(id);
			return res.status(200).json({ delivered: true });
		}
	}

	// Somebody's transfer of this exact release is already running. A second
	// one would spend another TorBox fetch on the same bytes; once the first
	// lands, the cron's free delivery adds it to this asker too.
	const existing = await db.getDebridTransfer(request.hash).catch(() => null);
	if (existing?.status === 'pending' && (await isTransferStillValid(existing))) {
		return res.status(409).json({
			error: 'this release is already being transferred, and will reach the asker when it lands',
			inProgress: true,
		});
	}

	const sizeBytes = request.sizeBytes == null ? undefined : Number(request.sizeBytes);
	if (exceedsTransferSizeCap(sizeBytes)) {
		return res.status(413).json({ error: tooLargeMessage(sizeBytes as number) });
	}

	// Before the claim, so a fulfiller whose TorBox account cannot source the
	// transfer never takes the request off the board.
	if (await isFreeTorBoxPlan(sourceKeys.tb_api_key)) {
		return res.status(403).json({ error: FREE_TORBOX_PLAN_MESSAGE });
	}

	// Also before the claim: the uploader only moves what TorBox already has, and
	// a job for anything else fails `uncached` a second later. That was 219 of
	// the first 369 fulfilments. An unknown answer lets it through; only a
	// definite "not cached" keeps the request on the board untouched.
	const cached = await torboxCachedHashes(sourceKeys.tb_api_key, [request.hash]);
	if (cached && !cached.has(request.hash)) {
		return res.status(409).json({
			error: 'TorBox does not have this release cached, so it cannot be sent yet',
			uncached: true,
		});
	}

	// Claim before doing any work. The status is part of the update's `where`,
	// so if two fulfillers arrive together the database picks one and the other
	// is told the request is taken — rather than both spending their own quota
	// fetching the same release.
	const claimed = await db.claimContentRequest(id, fulfillerId);
	if (!claimed) return res.status(409).json({ error: 'somebody else just took this request' });

	const requesterToken = await mintRequesterToken(request.requesterId);
	if (!requesterToken) {
		// Stalled, not failed: every other fulfiller would hit the same wall.
		await db.stallContentRequest(id, 'the requester has no usable Real-Debrid credentials');
		return res.status(409).json({
			error: 'the requester needs to reconnect Real-Debrid before this can be fulfilled',
		});
	}

	const body = JSON.stringify({
		input: `magnet:?xt=urn:btih:${request.hash}`,
		imdb_id: request.imdbId,
		rd_api_key: requesterToken,
		...sourceKeys,
	});

	let lastNetworkError = false;
	for (const server of orderedServersForNewJob(sizeBytes)) {
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
			// The same records a direct submission writes. Without the pending
			// mapping, 359 of the first 369 fulfilments were invisible to the
			// dedup check, the "In RD" badge and the cron that files completed
			// transfers into search.
			await Promise.all([
				db.attachContentRequestJob(id, data.id, server),
				db
					.recordDebridTransferPending(request.hash, data.id, request.imdbId)
					.catch((e) => console.error('Recording pending transfer failed:', e)),
				db
					.recordDebridJobServer(data.id, server)
					.catch((e) => console.error('Recording job server failed:', e)),
				// Filed under the *requester*, because the transfer lands in their
				// Real-Debrid account and the Transfers page keys on that.
				db
					.recordTransferMeta({
						source: 'debrid',
						jobId: data.id,
						imdbId: request.imdbId,
						title: request.title ?? undefined,
						returnPath: request.returnPath ?? undefined,
					})
					.catch((e) => console.error('Recording transfer context failed:', e)),
			]);
			return res.status(200).json({ jobId: data.id });
		}

		// Busy or broken on the uploader's side, not a verdict on the request: its
		// per-user job ceiling answers 429 ("job limit reached", seven requests
		// recorded as failed that way by 2026-09-24). Hand it back untouched.
		if (response.status === 429 || response.status >= 500) {
			await db.returnContentRequestClaim(id);
			return res.status(503).json({
				error: 'the uploader is busy right now, try again in a minute',
				busy: true,
			});
		}

		// The uploader refused it — a deterministic answer, so stop and hand the
		// request back to the board rather than retrying it on another host.
		const reason =
			typeof data?.error === 'string' ? data.error : `uploader answered ${response.status}`;
		await db.releaseContentRequest(id, reason);
		return res.status(response.status).json({ error: reason });
	}

	// Our side is down, which says nothing about the request: put it back as it
	// was instead of recording a failed attempt against it.
	await db.returnContentRequestClaim(id);
	return res.status(502).json({
		error: lastNetworkError ? 'All debrid uploader servers unreachable' : 'no server',
	});
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
