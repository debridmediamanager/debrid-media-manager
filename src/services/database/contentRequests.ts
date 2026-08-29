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
	}): Promise<StoredRequest> {
		const row = await this.prisma.contentRequest.upsert({
			where: { hash_requesterId: { hash: input.hash, requesterId: input.requesterId } },
			create: input,
			update: {},
		});

		// Withdrawing is not permanent, and the unique key is what makes that a
		// problem worth code: one row per release per person means a cancelled ask
		// is the *only* row that release can ever have for them, so leaving it
		// alone would make the second ask look like it worked and do nothing.
		// `cancelled` is the one status this moves — `open` and `failed` are
		// already on the board, `claimed` must not be dragged back under a running
		// transfer, and `fulfilled` has already landed.
		if (row.status !== 'cancelled') return row;
		const { count } = await this.prisma.contentRequest.updateMany({
			where: { id: row.id, status: 'cancelled' },
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

	/** Record the transfer a claim produced, and which host is running it. */
	public async attachJob(id: string, jobId: string, jobHost: string): Promise<void> {
		await this.prisma.contentRequest.updateMany({
			where: { id },
			data: { status: 'fulfilled', jobId, jobHost },
		});
	}

	/**
	 * Hand a failed claim back to the board.
	 *
	 * `fulfillerId` is cleared with it: the row is open again, and leaving the
	 * previous fulfiller on it would misreport who is responsible for a request
	 * that is nobody's.
	 */
	public async releaseRequest(id: string, error: string): Promise<void> {
		await this.prisma.contentRequest.updateMany({
			where: { id },
			data: { status: 'failed', fulfillerId: null, error: error.slice(0, 500) },
		});
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
			where: { id, requesterId, status: { in: ['open', 'failed'] } },
			data: { status: 'cancelled' },
		});
		return count > 0;
	}
}
