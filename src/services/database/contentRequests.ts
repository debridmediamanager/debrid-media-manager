import type { MediaType, StoredRequest } from '@/utils/contentRequest';
import { DatabaseClient } from './client';

/**
 * Storage for the request board.
 *
 * Every write that changes who owns a request goes through a *conditional*
 * update rather than a read-then-write. Two fulfillers clicking the same open
 * row a second apart is the ordinary case, not a rare one, and a read-then-write
 * lets both of them win — each spending their own TorBox quota fetching the same
 * release, with no way to give the loser theirs back.
 */
export class ContentRequestService extends DatabaseClient {
	/**
	 * File a request, or hand back the one already there.
	 *
	 * Upsert rather than create so a second ask for the same release is idle
	 * instead of a unique-constraint error the UI would have to interpret. A row
	 * that already exists is returned untouched — re-asking must not drag a
	 * `claimed` request back to `open` and strand the transfer running against it.
	 */
	public async createRequest(input: {
		hash: string;
		imdbId: string;
		title: string | null;
		mediaType: MediaType;
		requesterId: string;
		sizeBytes?: number | null;
		returnPath?: string | null;
	}): Promise<StoredRequest> {
		const { sizeBytes, ...rest } = input;
		const row = await this.prisma.contentRequest.upsert({
			where: { hash_requesterId: { hash: input.hash, requesterId: input.requesterId } },
			create: { ...rest, sizeBytes: sizeBytes == null ? null : BigInt(sizeBytes) },
			update: {},
		});

		// Withdrawing is not permanent, and the unique key is what makes that a
		// problem worth code: one row per release per person means a cancelled ask
		// is the *only* row that release can ever have for them, so leaving it
		// alone would make the second ask look like it worked and do nothing.
		// `cancelled` and `stalled` are the statuses this moves — `open` and
		// `failed` are already on the board, `claimed` must not be dragged back
		// under a running transfer, and `fulfilled` has already landed. A stalled
		// ask is waiting on exactly this: the asker coming back signed in.
		if (row.status !== 'cancelled' && row.status !== 'stalled') return row;
		const { count } = await this.prisma.contentRequest.updateMany({
			where: { id: row.id, status: row.status },
			data: { status: 'open', fulfillerId: null, error: null },
		});
		return count === 0 ? row : ((await this.getRequest(row.id)) ?? row);
	}

	public async getRequest(id: string): Promise<StoredRequest | null> {
		return this.prisma.contentRequest.findUnique({ where: { id } });
	}

	/**
	 * The board: what anyone could pick up, oldest first so nothing starves.
	 *
	 * `offset` is what makes the page's infinite scroll possible. Ordering is
	 * `createdAt` then `id` rather than `createdAt` alone: two requests filed in
	 * the same millisecond would otherwise have no defined order between pages,
	 * so one could repeat on page two while another was skipped entirely.
	 */
	public async listOpenRequests(limit: number, offset = 0): Promise<StoredRequest[]> {
		return this.prisma.contentRequest.findMany({
			where: { status: { in: ['open', 'failed'] } },
			orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
			take: limit,
			skip: offset,
		});
	}

	/**
	 * The board one row per release, most-wanted first.
	 *
	 * Every ask for a release is its own row, but one transfer serves them all:
	 * once it lands on Real-Debrid the cron adds it to every other asker's
	 * library for free. So a fulfiller sees each release once with how many
	 * people want it, and the release that helps the most people comes first.
	 * Ties go oldest first so nothing starves, then by hash so pages are stable.
	 *
	 * The row standing for a release is the viewer's own when they asked for it,
	 * so a cancel from the board withdraws their ask, and otherwise the oldest.
	 */
	public async listOpenBoard(
		limit: number,
		offset: number,
		viewerId: string | null
	): Promise<(StoredRequest & { wantedBy: number })[]> {
		const where = { status: { in: ['open', 'failed'] } };
		const groups = await this.prisma.contentRequest.groupBy({
			by: ['hash'],
			where,
			_count: { hash: true },
			_min: { createdAt: true },
			orderBy: [
				{ _count: { hash: 'desc' } },
				{ _min: { createdAt: 'asc' } },
				{ hash: 'asc' },
			],
			take: limit,
			skip: offset,
		});
		if (groups.length === 0) return [];
		const rows = await this.prisma.contentRequest.findMany({
			where: { ...where, hash: { in: groups.map((g) => g.hash) } },
			orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
		});
		const byHash = new Map<string, StoredRequest>();
		for (const row of rows) {
			const held = byHash.get(row.hash);
			if (!held || (viewerId !== null && row.requesterId === viewerId)) {
				byHash.set(row.hash, row);
			}
		}
		return groups.flatMap((g) => {
			const row = byHash.get(g.hash);
			return row ? [{ ...row, wantedBy: g._count.hash }] : [];
		});
	}

	/** One person's own asks, newest first, whatever state they are in. */
	public async listRequestsFor(requesterId: string, limit: number): Promise<StoredRequest[]> {
		return this.prisma.contentRequest.findMany({
			where: { requesterId },
			orderBy: { createdAt: 'desc' },
			take: limit,
		});
	}

	/**
	 * Take a request, if it is still there to take.
	 *
	 * The status is part of the `where`, so the database decides the race and
	 * the loser gets `null` rather than a second transfer. `updateMany` is what
	 * makes that possible — `update` throws on a miss, which cannot be told
	 * apart from the row having been deleted.
	 *
	 * @returns the claimed row, or `null` if somebody else got there first.
	 */
	public async claimRequest(id: string, fulfillerId: string): Promise<StoredRequest | null> {
		const { count } = await this.prisma.contentRequest.updateMany({
			where: { id, status: { in: ['open', 'failed'] } },
			data: { status: 'claimed', fulfillerId, error: null },
		});
		if (count === 0) return null;
		return this.getRequest(id);
	}

	/**
	 * Record the transfer a claim produced, and which host is running it.
	 *
	 * The row stays `claimed`. A job the uploader accepted is not a job that
	 * delivered: on 2026-09-24, 322 of the 369 requests this used to mark
	 * `fulfilled` at submission had failed on the uploader, 219 of them because the
	 * fulfiller's TorBox did not have the release. Marking them done took them off
	 * the board for good and told the asker nothing. `settleDelivered` and
	 * `releaseRequest` move the row on once the job has actually ended.
	 */
	public async attachJob(id: string, jobId: string, jobHost: string): Promise<void> {
		await this.prisma.contentRequest.updateMany({
			where: { id, status: 'claimed' },
			data: { jobId, jobHost },
		});
	}

	/**
	 * The transfer landed in the asker's library.
	 *
	 * Conditional on the job id as well as the status, so a late answer about an
	 * earlier attempt cannot close a request somebody has since claimed again.
	 */
	public async settleDelivered(id: string, jobId: string): Promise<boolean> {
		const { count } = await this.prisma.contentRequest.updateMany({
			where: { id, status: 'claimed', jobId },
			data: { status: 'fulfilled', error: null, fulfilledAt: new Date() },
		});
		return count > 0;
	}

	/**
	 * Close a request that needed no transfer: its release was already on
	 * Real-Debrid and has been added to the asker's account. Only a row still
	 * on the board moves, so this cannot overwrite a running claim.
	 */
	public async markDelivered(id: string): Promise<boolean> {
		const { count } = await this.prisma.contentRequest.updateMany({
			where: { id, status: { in: ['open', 'failed'] } },
			data: { status: 'fulfilled', error: null },
		});
		return count > 0;
	}

	/**
	 * Claimed rows oldest-touched first, for the sweep that settles them.
	 * `touchClaimed` sends a row still in flight to the back of that queue.
	 */
	public async listClaimedRequests(limit: number): Promise<StoredRequest[]> {
		return this.prisma.contentRequest.findMany({
			where: { status: 'claimed' },
			orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
			take: limit,
		});
	}

	public async touchClaimed(id: string): Promise<void> {
		await this.prisma.contentRequest.updateMany({
			where: { id, status: 'claimed' },
			data: { updatedAt: new Date() },
		});
	}

	/**
	 * Hand a failed claim back to the board.
	 *
	 * `fulfillerId` is cleared with it: the row is open again, and leaving the
	 * previous fulfiller on it would misreport who is responsible for a request
	 * that is nobody's. Only a `claimed` row moves, and when `jobId` is given only
	 * the claim that job belongs to, so a stale failure cannot reopen a request
	 * that has since been delivered or withdrawn.
	 */
	public async releaseRequest(id: string, error: string, jobId?: string): Promise<boolean> {
		const { count } = await this.prisma.contentRequest.updateMany({
			where: { id, status: 'claimed', ...(jobId ? { jobId } : {}) },
			data: { status: 'failed', fulfillerId: null, error: error.slice(0, 500) },
		});
		return count > 0;
	}

	/**
	 * Take a claim off the board because the asker's side is broken.
	 *
	 * Their stored Real-Debrid credentials would not mint a token, so every
	 * fulfiller who tried would fail the same way. Seven requests went round
	 * that loop as `failed` by 2026-09-24. `stalled` keeps it off the board
	 * until the asker files it again, which `createRequest` turns back to
	 * `open`.
	 */
	public async stallRequest(id: string, error: string): Promise<boolean> {
		const { count } = await this.prisma.contentRequest.updateMany({
			where: { id, status: 'claimed' },
			data: { status: 'stalled', fulfillerId: null, error: error.slice(0, 500) },
		});
		return count > 0;
	}

	/**
	 * Undo a claim that never reached a fulfiller's attempt: the uploader was
	 * too busy to take the job. Nothing about the request or the fulfiller was
	 * wrong, so it goes back as `open` with no failure recorded against it.
	 */
	public async returnClaim(id: string): Promise<boolean> {
		const { count } = await this.prisma.contentRequest.updateMany({
			where: { id, status: 'claimed' },
			data: { status: 'open', fulfillerId: null },
		});
		return count > 0;
	}

	/**
	 * Sends that reached an asker through a transfer these fulfiller ids
	 * started. Rows the cron delivered free carry no fulfiller, and a fulfil that
	 * found the release already on Real-Debrid spent nobody's TorBox, so neither
	 * has a job and neither counts.
	 */
	public async listSendsBy(
		fulfillerIds: string[]
	): Promise<{ requesterId: string; fulfilledAt: Date | null; thankedAt: Date | null }[]> {
		if (fulfillerIds.length === 0) return [];
		return this.prisma.contentRequest.findMany({
			where: { fulfillerId: { in: fulfillerIds }, status: 'fulfilled', jobId: { not: null } },
			select: { requesterId: true, fulfilledAt: true, thankedAt: true },
		});
	}

	/** Sends per fulfiller id since `since` (all time when null), most first. */
	public async countSendsByFulfiller(
		since: Date | null,
		limit: number
	): Promise<{ fulfillerId: string; sends: number }[]> {
		const groups = await this.prisma.contentRequest.groupBy({
			by: ['fulfillerId'],
			where: {
				status: 'fulfilled',
				jobId: { not: null },
				fulfillerId: { not: null },
				...(since ? { fulfilledAt: { gte: since } } : {}),
			},
			_count: { fulfillerId: true },
			orderBy: { _count: { fulfillerId: 'desc' } },
			take: limit,
		});
		return groups.map((g) => ({
			fulfillerId: g.fulfillerId as string,
			sends: g._count.fulfillerId,
		}));
	}

	/**
	 * Thank whoever sent one's own request, once. Scoped to the asker in the
	 * `where` like a cancel, and only a send somebody made can be thanked.
	 */
	public async thankRequest(id: string, requesterId: string): Promise<string | null> {
		const { count } = await this.prisma.contentRequest.updateMany({
			where: {
				id,
				requesterId,
				status: 'fulfilled',
				fulfillerId: { not: null },
				thankedAt: null,
			},
			data: { thankedAt: new Date() },
		});
		if (count === 0) return null;
		return (await this.getRequest(id))?.fulfillerId ?? null;
	}

	/** Tie these fulfiller ids to a sponsorship, replacing any earlier tie. */
	public async linkFulfillers(
		fulfillerIds: string[],
		shortId: string,
		showName: boolean
	): Promise<void> {
		await this.prisma.$transaction([
			...fulfillerIds.map((fulfillerId) =>
				this.prisma.fulfillerLink.upsert({
					where: { fulfillerId },
					create: { fulfillerId, shortId, showName },
					update: { shortId, showName },
				})
			),
			// The name choice is the person's, so it holds for every id of theirs.
			this.prisma.fulfillerLink.updateMany({ where: { shortId }, data: { showName } }),
		]);
	}

	public async getFulfillerLinks(
		fulfillerIds: string[]
	): Promise<{ fulfillerId: string; shortId: string; showName: boolean }[]> {
		if (fulfillerIds.length === 0) return [];
		return this.prisma.fulfillerLink.findMany({
			where: { fulfillerId: { in: fulfillerIds } },
			select: { fulfillerId: true, shortId: true, showName: true },
		});
	}

	/** Every fulfiller id tied to these sponsorships. */
	public async getLinksForSponsors(
		shortIds: string[]
	): Promise<{ fulfillerId: string; shortId: string; showName: boolean }[]> {
		if (shortIds.length === 0) return [];
		return this.prisma.fulfillerLink.findMany({
			where: { shortId: { in: shortIds } },
			select: { fulfillerId: true, shortId: true, showName: true },
		});
	}

	public async getEarned(
		shortId: string
	): Promise<{ earnedUntil: Date; creditedBlocks: number } | null> {
		return this.prisma.sponsorEarned.findUnique({
			where: { shortId },
			select: { earnedUntil: true, creditedBlocks: true },
		});
	}

	/**
	 * Pay reward blocks, if nobody paid them first.
	 *
	 * Conditional on the blocks already paid, the same way a claim is
	 * conditional on status: two settles for one fulfiller in the same cron tick
	 * would otherwise both read "one block owed" and both pay it.
	 */
	public async payEarned(
		shortId: string,
		paidBlocks: number | null,
		blocks: number,
		earnedUntil: Date
	): Promise<boolean> {
		if (paidBlocks === null) {
			try {
				await this.prisma.sponsorEarned.create({
					data: { shortId, creditedBlocks: blocks, earnedUntil },
				});
				return true;
			} catch {
				// Somebody created it first; the next settle recounts.
				return false;
			}
		}
		const { count } = await this.prisma.sponsorEarned.updateMany({
			where: { shortId, creditedBlocks: paidBlocks },
			data: { creditedBlocks: blocks, earnedUntil },
		});
		return count > 0;
	}

	/**
	 * Withdraw one's own request.
	 *
	 * Scoped to the requester in the `where` clause rather than checked first,
	 * so there is no window between the check and the write, and no way to
	 * cancel somebody else's row by guessing an id.
	 */
	public async cancelRequest(id: string, requesterId: string): Promise<boolean> {
		const { count } = await this.prisma.contentRequest.updateMany({
			where: { id, requesterId, status: { in: ['open', 'failed', 'stalled'] } },
			data: { status: 'cancelled' },
		});
		return count > 0;
	}
}
