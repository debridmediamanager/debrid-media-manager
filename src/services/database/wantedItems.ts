import { Prisma } from '@prisma/client';
import { DatabaseClient } from './client';

export type WantedKind = 'movie' | 'show';

export interface WantedItemRow {
	id: string;
	imdbId: string;
	kind: WantedKind;
	title: string;
	/** Season numbers wanted, or null for every season, new ones included. */
	seasons: number[] | null;
	createdAt: Date;
	fulfilledAt: Date | null;
	lastPolledAt: Date | null;
}

/** At most this many titles a sponsor's zurg is asked to keep fetching. */
export const MAX_WANTED_ITEMS = 500;

function toRow(row: any): WantedItemRow {
	return {
		id: row.id,
		imdbId: row.imdbId,
		kind: row.kind === 'show' ? 'show' : 'movie',
		title: row.title,
		seasons: Array.isArray(row.seasons) ? row.seasons : null,
		createdAt: row.createdAt,
		fulfilledAt: row.fulfilledAt ?? null,
		lastPolledAt: row.lastPolledAt ?? null,
	};
}

/**
 * The titles a sponsor wants, which their zurg reads and fetches.
 *
 * Keyed on the gatekeeper `shortId` rather than the DMM API key, as
 * `SponsorProviderKeysService` is: a Reset API Key changes the key, not whose
 * list it is.
 */
export class WantedItemsService extends DatabaseClient {
	public async list(shortId: string): Promise<WantedItemRow[]> {
		if (!shortId) return [];
		const rows = await this.prisma.wantedItem.findMany({
			where: { shortId },
			orderBy: { createdAt: 'desc' },
		});
		return rows.map(toRow);
	}

	/**
	 * Adds a title, or replaces the seasons of one already wanted. Wanting a film
	 * again after zurg fetched it starts over, so its `fulfilledAt` is cleared.
	 * Null when the list is full.
	 */
	public async want(
		shortId: string,
		item: { imdbId: string; kind: WantedKind; title: string; seasons: number[] | null }
	): Promise<WantedItemRow | null> {
		const existing = await this.prisma.wantedItem.findUnique({
			where: { shortId_imdbId: { shortId, imdbId: item.imdbId } },
			select: { id: true },
		});
		if (
			!existing &&
			(await this.prisma.wantedItem.count({ where: { shortId } })) >= MAX_WANTED_ITEMS
		) {
			return null;
		}
		const seasons = item.seasons ?? Prisma.DbNull;
		const row = await this.prisma.wantedItem.upsert({
			where: { shortId_imdbId: { shortId, imdbId: item.imdbId } },
			update: { kind: item.kind, title: item.title, seasons, fulfilledAt: null },
			create: { shortId, imdbId: item.imdbId, kind: item.kind, title: item.title, seasons },
		});
		return toRow(row);
	}

	/** False when the title was not on the list, which is not an error. */
	public async remove(shortId: string, imdbId: string): Promise<boolean> {
		const result = await this.prisma.wantedItem.deleteMany({ where: { shortId, imdbId } });
		return result.count > 0;
	}

	/** zurg's acknowledgement. Repeating it keeps the first date. False for an unknown id. */
	public async markFulfilled(shortId: string, id: string): Promise<boolean> {
		const row = await this.prisma.wantedItem.findFirst({
			where: { shortId, id },
			select: { fulfilledAt: true },
		});
		if (!row) return false;
		if (!row.fulfilledAt) {
			await this.prisma.wantedItem.updateMany({
				where: { shortId, id, fulfilledAt: null },
				data: { fulfilledAt: new Date() },
			});
		}
		return true;
	}

	/** Records that the sponsor's zurg read the list, for the page's "last checked". */
	public async touchPolled(shortId: string): Promise<void> {
		await this.prisma.wantedItem.updateMany({
			where: { shortId },
			data: { lastPolledAt: new Date() },
		});
	}
}
