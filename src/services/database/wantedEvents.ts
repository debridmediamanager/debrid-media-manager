import { Prisma } from '@prisma/client';
import { DatabaseClient } from './client';

export type WantedEventKind = 'grabbed' | 'rejected' | 'failed' | 'removed';

/** Verdicts on the release itself, which count against it for every sponsor. */
export const CONTENT_REASONS = [
	'wrong_content',
	'no_video',
	'sample',
	'missing_articles',
	'provider_gave_up',
	'unreadable_nzb',
	'password',
];
/** One zurg's own rules or luck: shown in that sponsor's history, never shared. */
export const LOCAL_REASONS = [
	'quality',
	'language',
	'size',
	'excluded',
	'provider_refused',
	'add_failed',
	'fetch_failed',
	'upgraded',
	'other',
];
/** Why a search ended with nothing (kind `failed`). */
export const FAILED_REASONS = ['nothing_found', 'nothing_passed', 'indexers_benched', 'other'];

/** What a show's zurg holds of one season: aired episode numbers. */
export interface WantedSeasonProgress {
	season: number;
	have: number[];
	missing: number[];
}

/** One event as zurg reported it, validated. Empty strings where it did not say. */
export interface WantedEventInput {
	itemId: string;
	key: string;
	at: Date;
	kind: WantedEventKind;
	reason: string;
	detail: string;
	release: string;
	torrent: boolean;
	hash: string | null;
	nzb: string | null;
	/** The qualified release id its `dmm_id` token named; server only. */
	dmmId: string | null;
	size: number | null;
	posted: Date | null;
	season: number | null;
	episode: number | null;
	pack: boolean;
	resolution: string;
}

export type WantedEventRow = Omit<WantedEventInput, 'itemId' | 'key'>;

/** One release of a title as every sponsor's shared events add up. */
export interface WantedHintRow {
	imdbId: string;
	/** An info hash (40 hex), a qualified release id (has a `:`) or an NZB sha256 (64 hex). */
	ref: string;
	release: string;
	size: number | null;
	resolution: string;
	season: number | null;
	episode: number | null;
	pack: boolean;
	nzb: string | null;
	/** Distinct sponsors who took it. */
	taken: number;
	/** Their shortIds, which MySQL cuts at 1,024 bytes: complete only when it holds `taken` of them. */
	takers: string[];
	/** Distinct sponsors who turned it down with a content verdict. */
	refused: number;
	lastTaken: Date | null;
	lastRefused: Date | null;
	/** The store holds the uploaded NZB of this sha. */
	held: boolean;
}

const DAY_MS = 24 * 60 * 60_000;
/** How long an event is kept: one zurg's own rules and empty searches, then what hints count. */
export const WANTED_LOCAL_TTL_MS = 30 * DAY_MS;
export const WANTED_SHARED_TTL_MS = 180 * DAY_MS;

/** Events the website shows for one item. */
export const HISTORY_SHOWN = 200;

export const isShared = (kind: string, reason: string) =>
	kind === 'grabbed' || (kind !== 'failed' && CONTENT_REASONS.includes(reason));

/**
 * The history zurg reports for wanted titles (`WantedEvent`), a show's have/missing
 * snapshot (`WantedItem.progress`) and which uploaded NZBs the store holds (`WantedNzb`).
 */
export class WantedEventsService extends DatabaseClient {
	/** Which of these item ids are on the sponsor's list, with what `record` needs of each. */
	public async owned(
		shortId: string,
		ids: string[]
	): Promise<Map<string, { imdbId: string; kind: string }>> {
		if (!ids.length) return new Map();
		const rows = await this.prisma.wantedItem.findMany({
			where: { shortId, id: { in: ids } },
			select: { id: true, imdbId: true, kind: true },
		});
		return new Map(rows.map((row) => [row.id, { imdbId: row.imdbId, kind: row.kind }]));
	}

	/**
	 * Stores events of items `owned` answered. One already stored under its item and
	 * key is left as it is. Answers how many were new.
	 */
	public async record(
		shortId: string,
		owned: Map<string, { imdbId: string }>,
		events: WantedEventInput[],
		now = new Date()
	): Promise<number> {
		const data = events.flatMap((event) => {
			const item = owned.get(event.itemId);
			if (!item) return [];
			return [
				{
					...event,
					shortId,
					imdbId: item.imdbId,
					// A zurg's clock can run ahead; nothing happened after DMM heard of it.
					at: event.at > now ? now : event.at,
					size: event.size === null ? null : BigInt(event.size),
					// A verdict counts for others only on a release they can tell it by.
					shared:
						isShared(event.kind, event.reason) &&
						!!(event.hash || event.nzb || event.dmmId),
				},
			];
		});
		if (!data.length) return 0;
		const { count } = await this.prisma.wantedEvent.createMany({ data, skipDuplicates: true });
		// One "nothing taken" per item and reason, the newest: zurg keys each on its
		// wording, which changes with every count, and keeps only the last itself.
		const failed = new Map<string, (typeof data)[number]>();
		for (const row of data) {
			if (row.kind === 'failed') failed.set(`${row.itemId} ${row.reason}`, row);
		}
		for (const row of failed.values()) {
			await this.prisma.wantedEvent.deleteMany({
				where: {
					itemId: row.itemId,
					shortId,
					kind: 'failed',
					reason: row.reason,
					key: { not: row.key },
				},
			});
		}
		return count;
	}

	/** Replaces a show's snapshot whole. */
	public async setProgress(
		shortId: string,
		id: string,
		progress: WantedSeasonProgress[]
	): Promise<void> {
		await this.prisma.wantedItem.updateMany({
			where: { shortId, id },
			data: { progress: progress as unknown as Prisma.InputJsonValue },
		});
	}

	/** Which of these NZB sha256s the store holds an upload of. */
	public async heldNzbs(shas: string[]): Promise<Set<string>> {
		if (!shas.length) return new Set();
		const rows = await this.prisma.wantedNzb.findMany({
			where: { sha: { in: shas } },
			select: { sha: true },
		});
		return new Set(rows.map((row) => row.sha));
	}

	/** Records that the store holds this NZB. Nothing about who sent it. */
	public async markNzbHeld(sha: string): Promise<void> {
		await this.prisma.wantedNzb.createMany({ data: [{ sha }], skipDuplicates: true });
	}

	/** Whether this sponsor reported grabbing an NZB of this sha that DMM did not serve. */
	public async reportedNzb(shortId: string, sha: string): Promise<boolean> {
		const row = await this.prisma.wantedEvent.findFirst({
			where: { nzb: sha, shortId, kind: 'grabbed', torrent: false, dmmId: null },
			select: { id: true },
		});
		return row !== null;
	}

	/** An item's snapshot and its newest events, or null when it is not on the sponsor's list. */
	public async history(
		shortId: string,
		id: string
	): Promise<{ seasons: WantedSeasonProgress[]; events: WantedEventRow[] } | null> {
		const item = await this.prisma.wantedItem.findFirst({
			where: { shortId, id },
			select: { progress: true },
		});
		if (!item) return null;
		const rows = await this.prisma.wantedEvent.findMany({
			where: { itemId: id, shortId },
			orderBy: [{ at: 'desc' }, { id: 'desc' }],
			take: HISTORY_SHOWN,
		});
		return {
			seasons: Array.isArray(item.progress)
				? (item.progress as unknown as WantedSeasonProgress[])
				: [],
			events: rows.map((row) => ({
				at: row.at,
				kind: row.kind as WantedEventKind,
				reason: row.reason,
				detail: row.detail,
				release: row.release,
				torrent: row.torrent,
				hash: row.hash,
				nzb: row.nzb,
				dmmId: row.dmmId,
				size: row.size === null ? null : Number(row.size),
				posted: row.posted,
				season: row.season,
				episode: row.episode,
				pack: row.pack,
				resolution: row.resolution,
			})),
		};
	}

	/**
	 * Every release sponsors took or condemned for these titles, one row a release,
	 * in one grouped read over `(imdbId, shared)`: forced, since `shared = 1` alone
	 * matches most of the table and MySQL picked that index on a small one. "Since" is
	 * judged on `createdAt`, DMM's clock, never on a zurg's `at`.
	 */
	public async hintRows(imdbIds: string[]): Promise<WantedHintRow[]> {
		if (!imdbIds.length) return [];
		const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
			SELECT e.imdbId AS imdbId,
				COALESCE(e.hash, e.dmmId, e.nzb) AS ref,
				MAX(e.\`release\`) AS \`release\`,
				MAX(e.size) AS size,
				MAX(e.resolution) AS resolution,
				MAX(e.season) AS season,
				MAX(e.episode) AS episode,
				MAX(e.pack) AS pack,
				MAX(e.nzb) AS nzb,
				COUNT(DISTINCT CASE WHEN e.kind = 'grabbed' THEN e.shortId END) AS taken,
				GROUP_CONCAT(DISTINCT CASE WHEN e.kind = 'grabbed' THEN e.shortId END) AS takers,
				COUNT(DISTINCT CASE WHEN e.kind <> 'grabbed' THEN e.shortId END) AS refused,
				MAX(CASE WHEN e.kind = 'grabbed' THEN e.createdAt END) AS lastTaken,
				MAX(CASE WHEN e.kind <> 'grabbed' THEN e.createdAt END) AS lastRefused,
				MAX(n.sha IS NOT NULL) AS held
			FROM WantedEvent e FORCE INDEX (WantedEvent_imdbId_shared_idx)
			LEFT JOIN WantedNzb n ON n.sha = e.nzb
			WHERE e.imdbId IN (${Prisma.join(imdbIds)})
				AND e.shared = 1
				AND COALESCE(e.hash, e.dmmId, e.nzb) IS NOT NULL
			GROUP BY e.imdbId, COALESCE(e.hash, e.dmmId, e.nzb)
		`);
		const int = (value: unknown) => (value === null ? null : Number(value));
		return rows.map((row) => ({
			imdbId: row.imdbId,
			ref: row.ref,
			release: row.release ?? '',
			size: int(row.size),
			resolution: row.resolution ?? '',
			season: int(row.season),
			episode: int(row.episode),
			pack: Number(row.pack) === 1,
			nzb: row.nzb ?? null,
			taken: Number(row.taken),
			takers: typeof row.takers === 'string' && row.takers ? row.takers.split(',') : [],
			refused: Number(row.refused),
			lastTaken: row.lastTaken ?? null,
			lastRefused: row.lastRefused ?? null,
			held: Number(row.held) === 1,
		}));
	}

	/**
	 * Drops events past their keep: `localBefore` for one zurg's own rules and empty
	 * searches, `sharedBefore` for grabs and content verdicts. Both ranges sit on
	 * `(shared, createdAt)`, so neither delete reads a row it keeps.
	 */
	public async prune(localBefore: Date, sharedBefore: Date): Promise<number> {
		const local = await this.prisma.wantedEvent.deleteMany({
			where: { shared: false, createdAt: { lt: localBefore } },
		});
		const shared = await this.prisma.wantedEvent.deleteMany({
			where: { shared: true, createdAt: { lt: sharedBefore } },
		});
		return local.count + shared.count;
	}
}
