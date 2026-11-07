import { Prisma } from '@prisma/client';
import { DatabaseClient } from './client';

export type WantedKind = 'movie' | 'show';

/** What zurg said it took when it acknowledged a title. Empty strings where it did not say. */
export type WantedFulfilled = {
	release: string;
	/** zurg's library id of it: an info hash or an NZB id. */
	grab: string;
	torrent: boolean;
	resolution: string;
	/** Set while zurg wants a better release, which keeps a fulfilled film on the list. */
	upgradeTo?: string;
	/**
	 * Films only, for a zurg that keeps a copy at each of several resolutions: what it
	 * took for each, keyed by that resolution (`1080p`, `2160p`). The fields above are
	 * then the first copy's, with no `upgradeTo`.
	 */
	bands?: Record<string, WantedTook>;
};

/** What zurg took for one resolution it keeps a copy at. */
export type WantedTook = Omit<WantedFulfilled, 'bands'>;

/**
 * One release the sponsor picked for zurg to grab, by "Send to zurg" on an Easynews
 * result. A film holds one; a show one per episode.
 */
export interface WantedPin {
	/** The Easynews file hash, which the stored NZB is keyed on. */
	id: string;
	/** The release's file name, extension included. */
	release: string;
	/** Bytes, 0 when unknown. */
	size: number;
	/** Shows only. */
	season?: number;
	episode?: number;
	/** When it was picked, as an ISO time. */
	at: string;
}

export interface WantedItemRow {
	id: string;
	imdbId: string;
	kind: WantedKind;
	title: string;
	/** Season numbers wanted, or null for every season, new ones included. */
	seasons: number[] | null;
	createdAt: Date;
	fulfilledAt: Date | null;
	fulfilled: WantedFulfilled | null;
	lastPolledAt: Date | null;
	/** Absent when nothing is pinned. */
	pins?: WantedPin[];
}

/** At most this many titles a sponsor's zurg is asked to keep fetching. */
export const MAX_WANTED_ITEMS = 5000;

function toRow(row: any): WantedItemRow {
	return {
		id: row.id,
		imdbId: row.imdbId,
		kind: row.kind === 'show' ? 'show' : 'movie',
		title: row.title,
		seasons: Array.isArray(row.seasons) ? row.seasons : null,
		createdAt: row.createdAt,
		fulfilledAt: row.fulfilledAt ?? null,
		fulfilled: row.fulfilled ?? null,
		lastPolledAt: row.lastPolledAt ?? null,
		...(Array.isArray(row.pins) && row.pins.length ? { pins: row.pins } : {}),
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
	 * again after zurg fetched it starts over, so its acknowledgement is cleared.
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
			update: {
				kind: item.kind,
				title: item.title,
				seasons,
				fulfilledAt: null,
				fulfilled: Prisma.DbNull,
			},
			create: { shortId, imdbId: item.imdbId, kind: item.kind, title: item.title, seasons },
		});
		return toRow(row);
	}

	/**
	 * Pins one release on a title, adding the title when it is not wanted yet: a
	 * show added this way follows no season (`seasons: []`), only its pins. A
	 * title already wanted keeps its kind, title and seasons. A film's pin
	 * replaces the one before and starts over, as `want` does; a show's replaces
	 * only the pin of the same episode. Null when the list is full.
	 */
	public async pinWanted(
		shortId: string,
		item: { imdbId: string; kind: WantedKind; title: string },
		pin: WantedPin
	): Promise<WantedItemRow | null> {
		const where = { shortId_imdbId: { shortId, imdbId: item.imdbId } };
		const existing = await this.prisma.wantedItem.findUnique({
			where,
			select: { id: true, pins: true },
		});
		if (
			!existing &&
			(await this.prisma.wantedItem.count({ where: { shortId } })) >= MAX_WANTED_ITEMS
		) {
			return null;
		}
		// ponytail: read-then-write, so two episodes pinned in the same instant can lose one; a transaction if that is ever seen
		const before = Array.isArray(existing?.pins)
			? (existing.pins as unknown as WantedPin[])
			: [];
		const pins = [
			...(item.kind === 'movie'
				? []
				: before.filter((p) => p.season !== pin.season || p.episode !== pin.episode)),
			pin,
		] as unknown as Prisma.InputJsonValue;
		const row = await this.prisma.wantedItem.upsert({
			where,
			update:
				item.kind === 'movie'
					? { pins, fulfilledAt: null, fulfilled: Prisma.DbNull }
					: { pins },
			create: {
				shortId,
				imdbId: item.imdbId,
				kind: item.kind,
				title: item.title,
				seasons: item.kind === 'movie' ? Prisma.DbNull : [],
				pins,
			},
		});
		return toRow(row);
	}

	/**
	 * Adds every title not on the list yet, as an import from Radarr or Sonarr does,
	 * leaving the ones already there as they are, until the list is full.
	 */
	public async wantMany(
		shortId: string,
		items: { imdbId: string; kind: WantedKind; title: string; seasons: number[] | null }[]
	): Promise<{ added: number; alreadyWanted: number; overCap: number }> {
		const existing = new Set(
			(
				await this.prisma.wantedItem.findMany({
					where: { shortId },
					select: { imdbId: true },
				})
			).map((row) => row.imdbId)
		);
		const fresh = items.filter((item) => !existing.has(item.imdbId));
		const taken = fresh.slice(0, Math.max(0, MAX_WANTED_ITEMS - existing.size));
		if (taken.length) {
			await this.prisma.wantedItem.createMany({
				data: taken.map((item) => ({
					shortId,
					imdbId: item.imdbId,
					kind: item.kind,
					title: item.title.slice(0, 512),
					seasons: item.seasons ?? Prisma.DbNull,
				})),
				skipDuplicates: true,
			});
		}
		return {
			added: taken.length,
			alreadyWanted: items.length - fresh.length,
			overCap: fresh.length - taken.length,
		};
	}

	/** False when the title was not on the list, which is not an error. */
	/** How many of the titles were on the list. */
	public async remove(shortId: string, imdbIds: string[]): Promise<number> {
		const result = await this.prisma.wantedItem.deleteMany({
			where: { shortId, imdbId: { in: imdbIds } },
		});
		return result.count;
	}

	/**
	 * zurg's acknowledgement, with what it took. Each one replaces what was stored,
	 * an upgrade wish included; the first date stands. With a `band` it replaces only
	 * that resolution's copy and keeps the others. False for an unknown id.
	 */
	public async markFulfilled(
		shortId: string,
		id: string,
		took: WantedTook,
		band?: string
	): Promise<boolean> {
		const row = await this.prisma.wantedItem.findFirst({
			where: { shortId, id },
			select: { fulfilledAt: true, fulfilled: true },
		});
		if (!row) return false;
		const before = (row.fulfilled ?? null) as WantedFulfilled | null;
		let fulfilled: WantedFulfilled;
		if (band) {
			const { upgradeTo: _, ...first } = took;
			fulfilled = { ...(before ?? first), bands: { ...before?.bands, [band]: took } };
		} else {
			fulfilled = before?.bands ? { ...took, bands: before.bands } : took;
		}
		await this.prisma.wantedItem.updateMany({
			where: { shortId, id },
			data: { fulfilled, fulfilledAt: row.fulfilledAt ?? new Date() },
		});
		return true;
	}

	/** How many titles are wanted, since when, and when a zurg last read the list. */
	public async summary(
		shortId: string
	): Promise<{ count: number; since: Date | null; lastPolledAt: Date | null }> {
		const r = await this.prisma.wantedItem.aggregate({
			where: { shortId },
			_count: { _all: true },
			_min: { createdAt: true },
			_max: { lastPolledAt: true },
		});
		return {
			count: r._count._all,
			since: r._min.createdAt ?? null,
			lastPolledAt: r._max.lastPolledAt ?? null,
		};
	}

	/** Records that the sponsor's zurg read the list, for the page's "last checked". */
	public async touchPolled(shortId: string): Promise<void> {
		await this.prisma.wantedItem.updateMany({
			where: { shortId },
			data: { lastPolledAt: new Date() },
		});
	}
}
