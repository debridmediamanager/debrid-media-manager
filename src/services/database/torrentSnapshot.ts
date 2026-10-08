import { mergeStoredSnapshot, type StoredSnapshot } from '@/utils/torrentSnapshot';
import { Prisma } from '@prisma/client';
import { DatabaseClient } from './client';

export interface SnapshotPayload {
	hash: string;
	addedDate: Date;
	id: string;
	payload: Prisma.InputJsonValue;
}

export interface SnapshotPost extends Omit<SnapshotPayload, 'payload'> {
	payload: StoredSnapshot;
}

const isUniqueKeyConflict = (error: unknown) =>
	error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

// InnoDB gives up one side of a deadlock (1213) and tells it to try again.
// Prisma names that P2034 on its own queries and P2010 on raw ones.
const isRetryableConflict = (error: unknown) =>
	isUniqueKeyConflict(error) ||
	(error instanceof Prisma.PrismaClientKnownRequestError &&
		(error.code === 'P2034' ||
			(error.code === 'P2010' && String(error.meta?.code) === '1213')));

const MERGE_ATTEMPTS = 3;

export type MergeCounts = { kept: number; borrowed: number };

// A raw query may hand a JSON column back as its text.
const asJson = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value);

export class TorrentSnapshotService extends DatabaseClient {
	/**
	 * Folds a zurg post into the release's stored snapshot (mergeStoredSnapshot)
	 * instead of replacing it, so a pass that probed one file of a pack keeps the
	 * probes earlier passes stored for the rest, and a new row of the release
	 * starts from the probes its newest other row holds.
	 *
	 * Reading the row and writing the merge back is one transaction holding the
	 * row's lock. Without it two posts of one release, each read before the
	 * other wrote, both write a merge that lacks the other's files. The insert
	 * comes first: it creates the row from this post or, if the row is there
	 * already or another post is creating it, waits for and takes its exclusive
	 * lock. A locking read of a missing row would take only a gap lock, which
	 * two posts can both hold, and their two creates then deadlock. The other
	 * row is only read: what it holds stays its own.
	 */
	public async mergeSnapshot(post: SnapshotPost): Promise<MergeCounts> {
		for (let attempt = 1; ; attempt++) {
			try {
				return await this.prisma.$transaction((tx) => this.mergeInto(tx, post), {
					maxWait: 10_000,
					timeout: 20_000,
				});
			} catch (error) {
				if (attempt >= MERGE_ATTEMPTS || !isRetryableConflict(error)) throw error;
			}
		}
	}

	private async mergeInto(
		tx: Prisma.TransactionClient,
		{ id, hash, addedDate, payload }: SnapshotPost
	): Promise<MergeCounts> {
		await tx.$executeRaw`
			INSERT INTO TorrentSnapshot (id, hash, addedDate, payload, updatedAt)
			VALUES (${id}, ${hash}, ${addedDate}, ${JSON.stringify(payload)}, ${new Date()})
			ON DUPLICATE KEY UPDATE id = id`;
		const [row] = await tx.$queryRaw<{ payload: unknown }[]>`
			SELECT payload FROM TorrentSnapshot WHERE id = ${id} FOR UPDATE`;
		const [other] = await tx.$queryRaw<{ payload: unknown }[]>`
			SELECT payload FROM TorrentSnapshot WHERE hash = ${hash} AND id <> ${id}
			ORDER BY addedDate DESC LIMIT 1`;
		const { snapshot, kept, borrowed } = mergeStoredSnapshot(
			asJson(row?.payload),
			payload,
			asJson(other?.payload)
		);
		await tx.torrentSnapshot.update({
			where: { id },
			data: { hash, addedDate, payload: snapshot },
			select: { id: true },
		});
		return { kept, borrowed };
	}

	/**
	 * Prisma's upsert on MySQL reads the row and then creates or updates it, so
	 * two posts of one release that both read before either has created the row
	 * both create it, and the second fails on the key. The row is there by then,
	 * so writing once more updates it. Over 2026-09-21..10-04 that collision
	 * answered 179 zurg posts with a 500.
	 */
	public async upsertSnapshot(snapshot: SnapshotPayload) {
		try {
			return await this.writeSnapshot(snapshot);
		} catch (error) {
			if (!isUniqueKeyConflict(error)) throw error;
			return this.writeSnapshot(snapshot);
		}
	}

	private writeSnapshot({ id, hash, addedDate, payload }: SnapshotPayload) {
		return this.prisma.torrentSnapshot.upsert({
			where: { id },
			update: {
				hash,
				addedDate,
				payload,
			},
			create: {
				id,
				hash,
				addedDate,
				payload,
			},
		});
	}

	public async getLatestSnapshot(hash: string) {
		return this.prisma.torrentSnapshot.findFirst({
			where: { hash },
			orderBy: { addedDate: 'desc' },
		});
	}

	public async getSnapshotsByHashes(hashes: string[]) {
		if (hashes.length === 0) {
			return [];
		}

		const snapshots = await this.prisma.torrentSnapshot.findMany({
			where: {
				hash: { in: hashes },
			},
			orderBy: { addedDate: 'desc' },
		});

		const snapshotMap = new Map<string, (typeof snapshots)[0]>();
		for (const snapshot of snapshots) {
			if (!snapshotMap.has(snapshot.hash)) {
				snapshotMap.set(snapshot.hash, snapshot);
			}
		}

		return Array.from(snapshotMap.values());
	}
}
