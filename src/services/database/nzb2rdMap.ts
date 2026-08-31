import { DatabaseClient } from './client';

/**
 * A Usenet → RD transfer produces a torrent that exists nowhere but Real-Debrid:
 * nzb2rd builds it around a webseed, so it has no announce and no DHT presence,
 * and its info hash cannot be known before the job finishes. There is no
 * original torrent hash to key on either — the release only ever existed as an
 * NZB — so transfers are keyed by the *indexer release id*, which is stable and
 * unique per posting.
 *
 * That mapping lets any user (not just the browser that started the job) see
 * that a release has already been fetched, and jump to the registered RD result
 * instead of paying for the same Usenet download twice.
 *
 * Stored in the generic `Cache` KV table under an `nzbrd:` prefix, mirroring how
 * DebridUploaderMapService stores TB → RD transfers — no migration needed.
 */
export type Nzb2rdTransferStatus = 'pending' | 'completed' | 'failed';

export interface Nzb2rdTransferRecord {
	releaseId: string;
	jobId: string;
	imdbId: string;
	status: Nzb2rdTransferStatus;
	/** The built torrent's hash. Only known once the job completes. */
	infoHash?: string;
	/**
	 * Why the job failed, as nzb2rd reported it. Carried so the row can say what
	 * went wrong rather than offering a bare Retry the user has no reason to
	 * trust — most of these are actionable ("reconnect Real-Debrid"), and a
	 * retry that repeats the same failure is worse than no button.
	 */
	error?: string;
	title?: string;
	updatedAt: number;
}

const KEY_PREFIX = 'nzbrd:';
const keyFor = (releaseId: string) => `${KEY_PREFIX}${releaseId.toLowerCase()}`;

/** Users waiting on someone else's in-flight job for this release. */
const WAIT_PREFIX = 'nzbwait:';
const waitKeyFor = (releaseId: string) => `${WAIT_PREFIX}${releaseId.toLowerCase()}`;

export interface Nzb2rdWaiter {
	/**
	 * Real-Debrid access token, held only until the job completes.
	 *
	 * On its own this is not enough to deliver with: RD expires it 24 hours after
	 * login and the job being waited on routinely takes days, so by the time
	 * `takeWaiters` runs it is usually dead — and the delivery failure is caught
	 * and logged, so the waiter silently receives nothing. Kept as the fallback
	 * for entries queued before `oauth` existed.
	 */
	rdKey: string;
	/** Long-lived credentials, so delivery can mint a token that actually works. */
	oauth?: { clientId: string; clientSecret: string; refreshToken: string } | null;
	imdbId: string;
	queuedAt: number;
}

export class Nzb2rdMapService extends DatabaseClient {
	async getTransfer(releaseId: string): Promise<Nzb2rdTransferRecord | null> {
		const row = await this.prisma.cache.findUnique({ where: { key: keyFor(releaseId) } });
		return row ? (row.value as unknown as Nzb2rdTransferRecord) : null;
	}

	async getTransfers(releaseIds: string[]): Promise<Nzb2rdTransferRecord[]> {
		if (releaseIds.length === 0) return [];
		const rows = await this.prisma.cache.findMany({
			where: { key: { in: releaseIds.map(keyFor) } },
		});
		return rows.map((r) => r.value as unknown as Nzb2rdTransferRecord);
	}

	private async put(record: Nzb2rdTransferRecord): Promise<void> {
		const value = { ...record, updatedAt: Date.now() } as unknown as object;
		await this.prisma.cache.upsert({
			where: { key: keyFor(record.releaseId) },
			update: { value } as any,
			create: { key: keyFor(record.releaseId), value } as any,
		});
	}

	async recordPending(
		releaseId: string,
		jobId: string,
		imdbId: string,
		title?: string
	): Promise<void> {
		// Never downgrade a completed mapping back to pending.
		const existing = await this.getTransfer(releaseId);
		if (existing?.status === 'completed') return;
		await this.put({
			releaseId: releaseId.toLowerCase(),
			jobId,
			imdbId,
			status: 'pending',
			title,
			updatedAt: Date.now(),
		});
	}

	async recordCompleted(
		releaseId: string,
		jobId: string,
		imdbId: string,
		infoHash: string,
		title?: string
	): Promise<void> {
		await this.put({
			releaseId: releaseId.toLowerCase(),
			jobId,
			imdbId,
			status: 'completed',
			infoHash: infoHash.toLowerCase(),
			title,
			updatedAt: Date.now(),
		});
	}

	/**
	 * Mark a release's job as failed, keeping the marker instead of dropping it.
	 *
	 * The marker used to be deleted here, which returned the row to a plain
	 * "Send" — correct in that a resubmit is allowed (`isTransferStillValid`
	 * answers false for a failed job), but it threw away the one thing worth
	 * saying: this release was already tried and did not work. A `failed` marker
	 * renders an enabled Retry carrying the reason, and never blocks the
	 * resubmit, because every dedup path treats a non-`completed` marker as
	 * something to re-check against nzb2rd rather than a veto.
	 *
	 * The waiter list still goes, exactly as `removeTransfer` drops it: those
	 * accounts queued behind a job that will never deliver, and their stored
	 * Real-Debrid credentials must not outlive it.
	 */
	async recordFailed(
		releaseId: string,
		jobId: string,
		imdbId: string,
		error?: string,
		title?: string
	): Promise<void> {
		// A completed fetch stays completed: the content is in RD regardless of
		// what a later job for the same release did.
		const existing = await this.getTransfer(releaseId);
		if (existing?.status === 'completed') return;
		await this.put({
			releaseId: releaseId.toLowerCase(),
			jobId,
			// Callers that only ever handled the job (the poll route) know the id
			// from nzb2rd's own record; the marker already holds it either way.
			imdbId: imdbId || existing?.imdbId || '',
			status: 'failed',
			error,
			title: title ?? existing?.title,
			updatedAt: Date.now(),
		});
		await this.clearWaiters(releaseId);
	}

	async removeTransfer(releaseId: string): Promise<void> {
		await this.prisma.cache
			.delete({ where: { key: keyFor(releaseId) } })
			.catch(() => undefined);
		await this.clearWaiters(releaseId);
	}

	// --- waiters -------------------------------------------------------------
	//
	// A second user asking for a release that is already being fetched must not
	// start a duplicate Usenet download, but they should still end up with the
	// content. So they are parked here, and the completion path adds the finished
	// torrent to each of their accounts — cheap, because by then Real-Debrid has
	// it cached and the add resolves instantly.
	//
	// Their access token is what makes that possible, so it lives here until the
	// job finishes and is deleted the moment it is used. Kept under a separate
	// key so the transfer record's own writes can never clobber the list.

	/** Bounded so a popular release cannot grow one row without limit. */
	static readonly MAX_WAITERS = 50;

	async addWaiter(
		releaseId: string,
		rdKey: string,
		imdbId: string,
		oauth?: Nzb2rdWaiter['oauth']
	): Promise<void> {
		const key = waitKeyFor(releaseId);
		try {
			const existing = await this.getWaiters(releaseId);
			// One entry per account: re-asking should not queue a second add.
			if (existing.some((w) => w.rdKey === rdKey)) return;
			const waiters = [
				...existing,
				{ rdKey, oauth: oauth ?? null, imdbId, queuedAt: Date.now() },
			].slice(-Nzb2rdMapService.MAX_WAITERS);
			const value = { waiters } as unknown as object;
			await this.prisma.cache.upsert({
				where: { key },
				update: { value } as any,
				create: { key, value } as any,
			});
		} catch (error) {
			console.error('Error queueing nzb2rd waiter:', error);
		}
	}

	async getWaiters(releaseId: string): Promise<Nzb2rdWaiter[]> {
		try {
			const row = await this.prisma.cache.findUnique({
				where: { key: waitKeyFor(releaseId) },
			});
			const value = row?.value as unknown as { waiters?: unknown } | undefined;
			return Array.isArray(value?.waiters) ? (value!.waiters as Nzb2rdWaiter[]) : [];
		} catch (error) {
			console.error('Error reading nzb2rd waiters:', error);
			return [];
		}
	}

	async clearWaiters(releaseId: string): Promise<void> {
		await this.prisma.cache
			.delete({ where: { key: waitKeyFor(releaseId) } })
			.catch(() => undefined);
	}

	/**
	 * Read the waiters and drop them in one step, so a second poll landing at the
	 * same moment cannot add the same torrent to the same account twice.
	 */
	async takeWaiters(releaseId: string): Promise<Nzb2rdWaiter[]> {
		const waiters = await this.getWaiters(releaseId);
		if (waiters.length > 0) await this.clearWaiters(releaseId);
		return waiters;
	}
}
