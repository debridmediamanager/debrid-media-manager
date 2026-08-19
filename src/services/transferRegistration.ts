import type { Nzb2rdWaiter } from '@/services/database';
import {
	buildTransferRegistration,
	originalHashFromInput,
	parseTransferContext,
	TransferJobFile,
} from '@/services/debridUploaderRegistration';
import { addHashToRdAccount, isValidImdbId } from '@/services/nzb2rd';
import { getToken } from '@/services/realDebrid';
import { repository as db } from '@/services/repository';

/**
 * Filing a finished transfer into DMM's own database, so the content it put in
 * one user's Real-Debrid account becomes a searchable, RD-cached result for
 * everyone else.
 *
 * This used to live in the two per-job status routes, which the Transfers page
 * polled once per job per tick. That page now polls a single `/api/transfers`,
 * so the registration had to move somewhere both callers could reach — and this
 * is not optional bookkeeping: an `nzb2rd` torrent is webseed-only, with no
 * announce and no DHT, so a release DMM does not record is reachable by nobody
 * but the one user who paid for the Usenet download.
 *
 * Both functions are idempotent and best-effort. They answer `false` for
 * anything already registered or lacking the page context to be filed under,
 * and the caller treats a throw as "not this tick".
 */

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

/**
 * Register a completed TB/AD → RD transfer.
 *
 * `server` is the debrid uploader host that owns this job, since only it can
 * serve the file list the registration is built from.
 */
export async function registerCompletedDebridJob(
	job: any,
	mediaType: unknown,
	seasonNum: unknown,
	server: string
): Promise<boolean> {
	const rewrittenHash = typeof job?.info_hash === 'string' ? job.info_hash.toLowerCase() : '';
	if (!/^[a-f0-9]{40}$/.test(rewrittenHash)) return false;

	// Always link the original hash to this completed transfer so any user's send
	// flow can dedup against it, even if the scraped/availability registration is
	// skipped (already registered, or no page context to file it under).
	const originalHash = originalHashFromInput(job.input);
	if (originalHash && job.imdb_id) {
		await db
			.recordDebridTransferCompleted(originalHash, job.id, job.imdb_id, rewrittenHash)
			.catch((e) => console.error('Recording completed transfer failed (non-fatal):', e));
	}

	const context = parseTransferContext(mediaType, seasonNum);
	if (!context) return false;

	const already = await db.checkAvailabilityByHashes([rewrittenHash]);
	if (already.length > 0) return false;

	const filesResponse = await fetch(`${server}/jobs/${job.id}/files`, {
		headers: { Accept: 'application/json' },
		signal: AbortSignal.timeout(15000),
	});
	if (!filesResponse.ok) return false;
	const files = (await filesResponse.json()) as TransferJobFile[];
	if (!Array.isArray(files)) return false;

	const registration = buildTransferRegistration({
		infoHash: rewrittenHash,
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

/**
 * Register a completed Usenet → RD transfer, and hand it to everyone who queued
 * behind it.
 *
 * nzb2rd's job record already carries everything the registration needs — the
 * built info_hash, the de-infringed name, and files as {name, size, rd_link} —
 * which is the exact shape `buildTransferRegistration` consumes, so the TB → RD
 * registration logic is reused verbatim rather than duplicated.
 */
export async function registerCompletedNzb2rdJob(
	job: any,
	mediaType: unknown,
	seasonNum: unknown,
	releaseId: string | undefined
): Promise<boolean> {
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
