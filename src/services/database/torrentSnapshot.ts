import { Prisma } from '@prisma/client';
import { DatabaseClient } from './client';

export interface SnapshotPayload {
	hash: string;
	addedDate: Date;
	id: string;
	payload: Prisma.InputJsonValue;
}

const isUniqueKeyConflict = (error: unknown) =>
	error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

export class TorrentSnapshotService extends DatabaseClient {
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
