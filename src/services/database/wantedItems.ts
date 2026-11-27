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
	/**
	 * With `seasons` null: the seasons left out of every other, which a season's
	 * Want button takes off. Seasons that air later are still wanted. Absent when none.
	 */
	except?: number[];
	createdAt: Date;
	fulfilledAt: Date | null;
	fulfilled: WantedFulfilled | null;
	lastPolledAt: Date | null;
	/** Absent when nothing is pinned. */
	pins?: WantedPin[];
	/**
	 * Shows only, once zurg reported it: per season how many aired episodes it holds
	 * and which it lacks. Absent from the list zurg polls.
	 */
	progress?: { season: number; have: number; missing: number[] }[];
}

/**
 * At most this many titles a sponsor's zurg is asked to keep fetching: every show and
 * each film still open (see `isOpen`). A film zurg is done with costs no poll, so it
 * does not count.
 */
export const MAX_WANTED_ITEMS = 10000;
/** Every row on the list, finished films included, so it cannot grow without end. */
export const MAX_WANTED_ROWS = 20000;

/** Polled-at for a sponsor, kept beside the rows so an empty list still records it. */
const polledKey = (shortId: string) => `wanted:polled:v1:${shortId}`;

/** What a zurg can take: an NZB needs a Usenet account there, a torrent a debrid account. */
export const WANTED_TAKES = ['nzb', 'torrent'] as const;
export type WantedTakes = (typeof WANTED_TAKES)[number];

/**
 * A title zurg still works on: every show (followed for new episodes), and a film it
 * has not fetched yet or holds a copy of it wants bettered.
 */
export function isOpen(row: {
	kind: string;
	fulfilledAt: Date | null;
	fulfilled: unknown;
}): boolean {
	if (row.kind === 'show' || !row.fulfilledAt) return true;
	const took = row.fulfilled as WantedFulfilled | null;
	// ponytail: a band zurg asks for but never fetched is not stored, so such a film counts as done; only the cap is looser for it
	return !!took?.upgradeTo || Object.values(took?.bands ?? {}).some((b) => !!b.upgradeTo);
}

type WantedSeasons = { seasons: number[] | null; except?: number[] };

/**
 * How `seasons` is stored: a list of the seasons wanted, null for every one, or
 * `{except: [...]}` for every one but those.
 */
function storedSeasons({ seasons, except }: WantedSeasons) {
	if (seasons) return seasons;
	return except?.length ? { except } : Prisma.DbNull;
}

function toRow(row: any): WantedItemRow {
	const except = Array.isArray(row.seasons?.except) ? (row.seasons.except as number[]) : [];
	return {
		id: row.id,
		imdbId: row.imdbId,
		kind: row.kind === 'show' ? 'show' : 'movie',
		title: row.title,
		seasons: Array.isArray(row.seasons) ? row.seasons : null,
		...(except.length ? { except } : {}),
		createdAt: row.createdAt,
		fulfilledAt: row.fulfilledAt ?? null,
		fulfilled: row.fulfilled ?? null,
		lastPolledAt: row.lastPolledAt ?? null,
		...(Array.isArray(row.pins) && row.pins.length ? { pins: row.pins } : {}),
		...(Array.isArray(row.progress) && row.progress.length
			? {
					progress: row.progress.map((s: any) => ({
						season: s.season,
						have: Array.isArray(s.have) ? s.have.length : 0,
						missing: Array.isArray(s.missing) ? s.missing : [],
					})),
				}
			: {}),
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
	/**
	 * The whole list, or with `imdbId` just that title's row (none or one).
	 * `withProgress: false` leaves the have/missing snapshots unread, for zurg's poll.
	 */
	public async list(
		shortId: string,
		imdbId?: string,
		withProgress = true
	): Promise<WantedItemRow[]> {
		if (!shortId) return [];
		const rows = await this.prisma.wantedItem.findMany({
			where: { shortId, ...(imdbId && { imdbId }) },
			orderBy: { createdAt: 'desc' },
			...(!withProgress && { omit: { progress: true } }),
		});
		return rows.map(toRow);
	}

	/** The titles listed now, and how many more fit under both caps. */
	private async room(shortId: string): Promise<{ listed: Set<string>; room: number }> {
		const rows = await this.prisma.wantedItem.findMany({
			where: { shortId },
			select: { imdbId: true, kind: true, fulfilledAt: true, fulfilled: true },
		});
		const open = rows.filter(isOpen).length;
		return {
			listed: new Set(rows.map((row) => row.imdbId)),
			room: Math.max(0, Math.min(MAX_WANTED_ITEMS - open, MAX_WANTED_ROWS - rows.length)),
		};
	}

	/**
	 * Adds a title, or replaces the seasons of one already wanted. Wanting a film
	 * again after zurg fetched it starts over, so its acknowledgement is cleared; a
	 * show keeps what zurg said it got, which a change of seasons does not undo.
	 * Null when the list is full.
	 */
	public async want(
		shortId: string,
		item: { imdbId: string; kind: WantedKind; title: string } & WantedSeasons
	): Promise<WantedItemRow | null> {
		const existing = await this.prisma.wantedItem.findUnique({
			where: { shortId_imdbId: { shortId, imdbId: item.imdbId } },
			select: { id: true },
		});
		if (!existing && (await this.room(shortId)).room < 1) return null;
		const seasons = storedSeasons(item);
		const row = await this.prisma.wantedItem.upsert({
			where: { shortId_imdbId: { shortId, imdbId: item.imdbId } },
			update: {
				kind: item.kind,
				title: item.title,
				seasons,
				...(item.kind === 'show' ? {} : { fulfilledAt: null, fulfilled: Prisma.DbNull }),
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
		if (!existing && (await this.room(shortId)).room < 1) return null;
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
		items: ({ imdbId: string; kind: WantedKind; title: string } & WantedSeasons)[]
	): Promise<{ added: number; alreadyWanted: number; overCap: number; dropped: string[] }> {
		const { listed, room } = await this.room(shortId);
		const fresh = items.filter((item) => !listed.has(item.imdbId));
		const taken = fresh.slice(0, room);
		if (taken.length) {
			await this.prisma.wantedItem.createMany({
				data: taken.map((item) => ({
					shortId,
					imdbId: item.imdbId,
					kind: item.kind,
					title: item.title.slice(0, 512),
					seasons: storedSeasons(item),
				})),
				skipDuplicates: true,
			});
		}
		const dropped = fresh.slice(taken.length).map((item) => item.imdbId);
		return {
			added: taken.length,
			alreadyWanted: items.length - fresh.length,
			overCap: dropped.length,
			dropped,
		};
	}

	/** How many of the titles were on the list. */
	public async remove(shortId: string, imdbIds: string[]): Promise<number> {
		const result = await this.prisma.wantedItem.deleteMany({
			where: { shortId, imdbId: { in: imdbIds } },
		});
		return result.count;
	}

	/**
	 * zurg's acknowledgement, with what it took. Each one replaces what was stored,
	 * an upgrade wish included; a film's first date stands. A show stays followed and
	 * zurg tells each new release it got, so its date is the latest one. With a `band`
	 * it replaces only that resolution's copy and keeps the others. False for an
	 * unknown id.
	 */
	public async markFulfilled(
		shortId: string,
		id: string,
		took: WantedTook,
		band?: string
	): Promise<boolean> {
		const row = await this.prisma.wantedItem.findFirst({
			where: { shortId, id },
			select: { kind: true, fulfilledAt: true, fulfilled: true },
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
			data: {
				fulfilled,
				fulfilledAt: (row.kind !== 'show' && row.fulfilledAt) || new Date(),
			},
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
		const polled = await this.polledAt(shortId);
		const rowsPolled = r._max.lastPolledAt ?? null;
		return {
			count: r._count._all,
			since: r._min.createdAt ?? null,
			lastPolledAt: polled && (!rowsPolled || polled > rowsPolled) ? polled : rowsPolled,
		};
	}

	/** When the sponsor's zurg last read the list, empty or not; null before the first read was recorded. */
	public async polledAt(shortId: string): Promise<Date | null> {
		return (await this.polled(shortId)).at;
	}

	/**
	 * What the sponsor's zurg said it can take when it last read the list (`nzb`,
	 * `torrent`), null when it did not say: a zurg from before 2026-11-24, or none yet.
	 */
	public async takes(shortId: string): Promise<WantedTakes[] | null> {
		return (await this.polled(shortId)).takes;
	}

	private async polled(
		shortId: string
	): Promise<{ at: Date | null; takes: WantedTakes[] | null }> {
		const row = await this.prisma.cache.findUnique({ where: { key: polledKey(shortId) } });
		const value = row?.value as { at?: string; takes?: unknown } | null;
		const takes = Array.isArray(value?.takes)
			? value.takes.filter((t): t is WantedTakes => WANTED_TAKES.includes(t as WantedTakes))
			: null;
		return { at: value?.at ? new Date(value.at) : null, takes };
	}

	/**
	 * Records that the sponsor's zurg read the list, for the page's "last checked", and
	 * what it said it takes, so Send to zurg is offered only where an NZB can be played.
	 * `takes` null is a zurg that did not say, and replaces what an earlier one said.
	 */
	public async touchPolled(shortId: string, takes: WantedTakes[] | null = null): Promise<void> {
		const now = new Date();
		const value = { at: now.toISOString(), takes };
		await Promise.all([
			this.prisma.wantedItem.updateMany({ where: { shortId }, data: { lastPolledAt: now } }),
			this.prisma.cache.upsert({
				where: { key: polledKey(shortId) },
				update: { value },
				create: { key: polledKey(shortId), value },
			}),
		]);
	}
}
