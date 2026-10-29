import { DatabaseClient } from './client';

export interface WantedListRow {
	id: string;
	shortId: string;
	url: string;
	name: string;
	/** IMDb ids on the list when it was last read; empty before the first read. */
	seen: string[];
	added: number;
	createdAt: Date;
	syncedAt: Date | null;
	error: string | null;
}

/** A list is read again this long after its last read, Radarr's import-list cadence. */
export const WANTED_LIST_SYNC_MS = 6 * 60 * 60 * 1000;

function toRow(row: any): WantedListRow {
	return {
		id: row.id,
		shortId: row.shortId,
		url: row.url,
		name: row.name,
		seen: Array.isArray(row.seen)
			? row.seen.filter((id: unknown) => typeof id === 'string')
			: [],
		added: row.added ?? 0,
		createdAt: row.createdAt,
		syncedAt: row.syncedAt ?? null,
		error: row.error ?? null,
	};
}

/** The Trakt and MDBList lists sponsors follow, keyed on `shortId` as `WantedItemsService` is. */
export class WantedListsService extends DatabaseClient {
	public async list(shortId: string): Promise<WantedListRow[]> {
		if (!shortId) return [];
		const rows = await this.prisma.wantedList.findMany({
			where: { shortId },
			orderBy: { createdAt: 'asc' },
		});
		return rows.map(toRow);
	}

	/** The row for a list already followed, or a new unread one. `created` says which. */
	public async follow(
		shortId: string,
		url: string,
		name: string
	): Promise<{ row: WantedListRow; created: boolean }> {
		const existing = await this.prisma.wantedList.findUnique({
			where: { shortId_url: { shortId, url } },
		});
		if (existing) return { row: toRow(existing), created: false };
		const row = await this.prisma.wantedList.create({
			data: { shortId, url, name, seen: [] },
		});
		return { row: toRow(row), created: true };
	}

	/** False when the sponsor was not following that list, which is not an error. */
	public async remove(shortId: string, id: string): Promise<boolean> {
		const result = await this.prisma.wantedList.deleteMany({ where: { shortId, id } });
		return result.count > 0;
	}

	/** Lists not read for `WANTED_LIST_SYNC_MS`, least recently read first. */
	public async due(limit: number, now = new Date()): Promise<WantedListRow[]> {
		const rows = await this.prisma.wantedList.findMany({
			where: {
				OR: [
					{ syncedAt: null },
					{ syncedAt: { lt: new Date(now.getTime() - WANTED_LIST_SYNC_MS) } },
				],
			},
			orderBy: { syncedAt: 'asc' },
			take: limit,
		});
		return rows.map(toRow);
	}

	public async recordRead(
		id: string,
		read: { name: string; seen: string[]; added: number }
	): Promise<void> {
		await this.prisma.wantedList.update({
			where: { id },
			data: {
				name: read.name.slice(0, 512),
				seen: read.seen,
				added: read.added,
				syncedAt: new Date(),
				error: null,
			},
		});
	}

	/** A failed read still counts as the read, so a broken list waits its turn like the rest. */
	public async recordFailure(id: string, error: string): Promise<void> {
		await this.prisma.wantedList.update({
			where: { id },
			data: { syncedAt: new Date(), error: error.slice(0, 512) },
		});
	}
}
