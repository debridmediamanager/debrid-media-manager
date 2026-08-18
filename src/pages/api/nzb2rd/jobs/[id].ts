import type { Nzb2rdWaiter } from '@/services/database';
import {
	buildTransferRegistration,
	parseTransferContext,
	TransferJobFile,
} from '@/services/debridUploaderRegistration';
import { addHashToRdAccount, getNzb2rdUrl, isValidImdbId } from '@/services/nzb2rd';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { getToken } from '@/services/realDebrid';
import { repository as db } from '@/services/repository';
import type { NextApiRequest, NextApiResponse } from 'next';

// When a poll observes a completed job, register the built torrent in DMM's DB
// (search row + RD availability) so it surfaces as an RD-cached result for
// everyone — the same treatment a TB → RD transfer gets. This matters more here
// than there: an nzb2rd torrent is webseed-only, with no announce and no DHT, so
// if DMM does not record it the content is reachable by nobody but the one user
// who paid for the Usenet download.
//
// nzb2rd's job record already carries everything the registration needs — the
// built info_hash, the de-infringed name, and files as {name, size, rd_link} —
// which is the exact shape buildTransferRegistration consumes, so the TB → RD
// registration logic is reused verbatim rather than duplicated.
/**
 * The token to deliver a finished release with.
 *
 * A waiter's stored `rdKey` is an OAuth access token that Real-Debrid expires 24
 * hours after login, and this list is drained only when the job it waits on
 * completes — days later, by design. So the stored token is normally dead, the
 * add throws, and the catch above turns that into a log line nobody reads: the
 * user waited and received nothing. Minting from the long-lived credentials
 * fixes it; falling back to the stored token keeps entries queued before those
 * were recorded working exactly as well as they did.
 */
async function deliveryKeyFor(waiter: Nzb2rdWaiter): Promise<string> {
	if (!waiter.oauth) return waiter.rdKey;
	try {
		const { access_token } = await getToken(
			waiter.oauth.clientId,
			waiter.oauth.clientSecret,
			waiter.oauth.refreshToken,
			true
		);
		return access_token || waiter.rdKey;
	} catch (error) {
		// Signed out, revoked, or RD is down. The stored token is very likely dead
		// too, but trying it costs one call and is the only remaining chance.
		console.error('Refreshing a waiting RD account token failed:', error);
		return waiter.rdKey;
	}
}

async function registerCompletedJob(
	job: any,
	mediaType: unknown,
	seasonNum: unknown,
	releaseId: string | undefined
) {
	const infoHash = typeof job?.info_hash === 'string' ? job.info_hash.toLowerCase() : '';
	if (!/^[a-f0-9]{40}$/.test(infoHash)) return false;
	if (!isValidImdbId(job?.imdb_id)) return false;

	// Record the completed transfer first, so the dedup lookup works even when
	// there is no page context to file a searchable row under.
	if (releaseId) {
		await db
			.recordNzb2rdTransferCompleted(
				releaseId,
				job.id,
				job.imdb_id,
				infoHash,
				typeof job.name === 'string' ? job.name : undefined
			)
			.catch((e) => console.error('Recording completed nzb2rd transfer failed:', e));
	}

	// Hand the finished torrent to everyone who asked for this release while it
	// was still being fetched. Their submission was deduped into this one job, so
	// without this they would have paid the wait and received nothing. RD has the
	// content cached by now, so each add resolves instantly.
	if (releaseId) {
		const waiters = await db.takeNzb2rdWaiters(releaseId).catch((e) => {
			console.error('Reading nzb2rd waiters failed:', e);
			return [];
		});
		for (const waiter of waiters) {
			try {
				await addHashToRdAccount(await deliveryKeyFor(waiter), infoHash);
			} catch (error) {
				// One account failing must not deny the rest; the key is spent either
				// way, so never log it.
				console.error(`Adding nzb2rd result to a waiting RD account failed:`, error);
			}
		}
		if (waiters.length > 0) {
			console.log(`[nzb2rd] job=${job.id} delivered to ${waiters.length} waiting account(s)`);
		}
	}

	const context = parseTransferContext(mediaType, seasonNum);
	if (!context) return false;

	const already = await db.checkAvailabilityByHashes([infoHash]);
	if (already.length > 0) return false;

	const files = Array.isArray(job.files) ? (job.files as TransferJobFile[]) : [];
	if (files.length === 0) return false;

	const registration = buildTransferRegistration({
		infoHash,
		imdbId: job.imdb_id,
		name: job.name,
		files,
		context,
		endedAt: job.completed_at,
	});
	if (!registration) return false;

	await db.saveScrapedTrueResults(registration.scrapedKey, [registration.scrapeEntry], true);
	await db.upsertAvailability(registration.availability);
	return true;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET' && req.method !== 'DELETE') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { id, mediaType, seasonNum, releaseId } = req.query;
	if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(id)) {
		return res.status(400).json({ error: 'Invalid job id' });
	}
	const release =
		typeof releaseId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(releaseId)
			? releaseId
			: undefined;

	try {
		// The caller's RD key is forwarded, never interpreted: nzb2rd authorizes
		// the delete against the job's owner, and this route has no idea who owns
		// what. Without it a cancel is refused there, which is the point — this
		// endpoint is public and used to forward any id straight through.
		const rdKey = req.headers['x-rd-api-key'];
		const headers: Record<string, string> = { Accept: 'application/json' };
		if (typeof rdKey === 'string' && rdKey) headers['x-rd-api-key'] = rdKey;

		const response = await fetch(`${getNzb2rdUrl()}/jobs/${encodeURIComponent(id)}`, {
			method: req.method,
			headers,
			signal: AbortSignal.timeout(15000),
		});
		const data = await response.json().catch(() => ({}));

		// A cancelled job must not keep blocking a resubmit of the same release.
		if (req.method === 'DELETE' && response.ok && release) {
			await db
				.removeNzb2rdTransfer(release)
				.catch((e) => console.error('Clearing nzb2rd transfer failed:', e));
		}

		if (req.method === 'GET' && response.ok && data?.status === 'completed') {
			try {
				data.dmm_registered = await registerCompletedJob(
					data,
					mediaType,
					seasonNum,
					release
				);
			} catch (error) {
				console.error('nzb2rd registration failed:', error);
			}
		}

		return res.status(response.status).json(data);
	} catch (error) {
		console.error('nzb2rd job request failed:', error);
		return res.status(502).json({ error: 'nzb2rd service unreachable' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
