/**
 * Plan a daily refresh of the `Anime` table: insert the AniDB entries it is
 * missing, fill the ids its rows lack, and fill the metadata rows left empty.
 *
 * The table was imported once and nothing has added to it since: 33,702 rows on
 * 2026-09-27, the newest AniDB id 20328, while AniDB listed 17,007 entries up to
 * 20419 and 3,527 of them had no row. Search can only find a row that has a
 * `kitsu_id` and a poster (`getAnimeByKitsuIds`), so a new season never became
 * findable in DMM however long it aired.
 *
 * Everything here is pure. The runner (`scripts/import-anime.ts`) downloads the
 * sources, reads the rows, calls `selectAnimeImportWork`, asks Kitsu for the ids
 * it names, calls `planAnimeImport` and writes the result.
 *
 * Rules, each stated where it is applied below:
 *  - an entry is inserted only when it can be found: it has a Kitsu id and
 *    Kitsu gives it a poster. The rest wait for Fribb to map them to Kitsu,
 *    which it does weekly, and are inserted by whichever run comes after;
 *  - adult entries are never inserted or filled;
 *  - an existing value is never overwritten, only empty ones filled;
 *  - every id column is unique, and a value another row holds is dropped, with
 *    new rows competing for a shared IMDb id under the same first-season rule
 *    `planAnimeMappingUpdates` applies to existing rows.
 */
import { aliasesFor, type AnidbEntry } from './anidbTitles';
import { isAdultEntry, typeFromAnimeLists, type AnimeListsEntry } from './animeLists';
import type { AnimeIdMapping } from './animeMapping';
import {
	planAnimeMappingUpdates,
	type AnimeMappingFields,
	type AnimeRow,
	type SyncableColumn,
	type SyncPlan,
} from './animeMappingSync';
import type { KitsuImportMeta } from './kitsu';

/** An `Anime` row as the importer reads it. */
export interface AnimeImportRow extends AnimeRow {
	title: string;
	type: string;
	aliases: unknown;
	description: string;
	poster_url: string;
	background_url: string;
	rating: number;
}

/** Columns a refresh may fill on an existing row. */
export interface AnimeMetadataFields {
	title?: string;
	aliases?: string[];
	description?: string;
	poster_url?: string;
	background_url?: string;
	rating?: number;
}

export type AnimeUpdateFields = AnimeMappingFields & AnimeMetadataFields;

export interface AnimeImportUpdate {
	id: number;
	fields: AnimeUpdateFields;
}

export interface AnimeInsert {
	anidb_id: number;
	kitsu_id: number;
	mal_id: number | null;
	anime_planet_id: string | null;
	imdb_id: string | null;
	title: string;
	type: string;
	aliases: string[];
	description: string;
	poster_url: string;
	background_url: string;
	rating: number;
	/** Kitsu's first air date. Logged for the spot check, never written. */
	startDate: string | null;
}

interface ImportCandidate {
	aid: number;
	kitsuId: number;
	mapping: AnimeIdMapping;
	anidb: AnidbEntry;
	lists: AnimeListsEntry | undefined;
}

export interface AnimeImportWork {
	/** The id fill for existing rows alone, before any new row competes. */
	fillPlan: SyncPlan;
	candidates: ImportCandidate[];
	/** Existing rows, with their filled ids, whose title or poster is empty. */
	enrichTargets: AnimeImportRow[];
	/** Every Kitsu id the plan needs metadata for. */
	kitsuIds: number[];
	counts: {
		anidbEntries: number;
		tableRows: number;
		missingAids: number;
		skippedAdult: number;
		skippedNoMapping: number;
		skippedNoKitsuId: number;
		skippedKitsuHeld: number;
		skippedKitsuShared: number;
	};
}

export interface AnimeImportPlan {
	updates: AnimeImportUpdate[];
	inserts: AnimeInsert[];
	counts: AnimeImportWork['counts'] & {
		candidates: number;
		kitsuAbsent: number;
		kitsuAdult: number;
		kitsuNoPoster: number;
		lostKitsuInPlan: number;
		inserts: number;
		insertsWithImdb: number;
		rowsWithIdFills: number;
		rowsEnriched: number;
		updates: number;
	};
	collisions: Record<SyncableColumn, number>;
}

/** Varchar(191) holds 191 characters; MySQL counts code points under utf8mb4. */
const VARCHAR_MAX = 191;
/** `TEXT` holds 65,535 bytes. Stay clear of it. */
const DESCRIPTION_MAX_BYTES = 60000;
/** Real rows are numbered from 1 and sit far below this, so a tie goes to them. */
const VIRTUAL_ID_BASE = 1_000_000_000;
const KNOWN_TYPES = new Set(['TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL']);
const KITSU_SUBTYPES: Record<string, string> = {
	tv: 'TV',
	movie: 'MOVIE',
	ova: 'OVA',
	ona: 'ONA',
	special: 'SPECIAL',
	music: 'SPECIAL',
};

const codePoints = (value: string) => Array.from(value);

/** A title too long for the column is cut; it is still the title. */
export function clipTitle(value: string): string {
	const chars = codePoints(value.trim());
	return chars.length <= VARCHAR_MAX ? chars.join('') : chars.slice(0, VARCHAR_MAX).join('');
}

/** A URL too long for the column is dropped; a cut one points nowhere. */
export function fitUrl(value: string): string {
	return value !== '' && codePoints(value).length <= VARCHAR_MAX ? value : '';
}

function clipDescription(value: string): string {
	const encoder = new TextEncoder();
	if (encoder.encode(value).length <= DESCRIPTION_MAX_BYTES) return value;
	let out = '';
	let bytes = 0;
	for (const char of value) {
		const size = encoder.encode(char).length;
		if (bytes + size > DESCRIPTION_MAX_BYTES) break;
		out += char;
		bytes += size;
	}
	return out;
}

/**
 * Kitsu hides its adult catalogue from anonymous callers, so most adult entries
 * are simply absent; the ones it does return carry `nsfw` or an R18 rating.
 */
export function isKitsuAdult(meta: KitsuImportMeta): boolean {
	return meta.nsfw || meta.ageRating === 'R18';
}

function typeFor(
	mapping: AnimeIdMapping,
	lists: AnimeListsEntry | undefined,
	kitsu: KitsuImportMeta
): string {
	if (mapping.type && KNOWN_TYPES.has(mapping.type)) return mapping.type;
	return (
		typeFromAnimeLists(lists) ??
		(kitsu.subtype ? KITSU_SUBTYPES[kitsu.subtype.toLowerCase()] : undefined) ??
		'UNKNOWN'
	);
}

function aliasesAreEmpty(aliases: unknown): boolean {
	return !Array.isArray(aliases) || aliases.length === 0;
}

function withFills(row: AnimeImportRow, fields: AnimeMappingFields | undefined): AnimeImportRow {
	return fields ? { ...row, ...fields } : row;
}

function indexByAnidb(mappings: AnimeIdMapping[]): Map<number, AnimeIdMapping> {
	const index = new Map<number, AnimeIdMapping>();
	for (const mapping of mappings) {
		if (mapping.anidbId !== null && !index.has(mapping.anidbId)) {
			index.set(mapping.anidbId, mapping);
		}
	}
	return index;
}

/**
 * Work out which AniDB entries are missing, which existing rows need metadata,
 * and which Kitsu ids that takes, before anything is fetched from Kitsu.
 */
export function selectAnimeImportWork(input: {
	rows: AnimeImportRow[];
	anidb: Map<number, AnidbEntry>;
	animeLists: Map<number, AnimeListsEntry>;
	mappings: AnimeIdMapping[];
}): AnimeImportWork {
	const { rows, anidb, animeLists, mappings } = input;

	// Existing rows claim their ids first. An entry whose row only lacked the
	// anidb id is not missing - the fill gives that row its id.
	const fillPlan = planAnimeMappingUpdates(rows, mappings);
	const fills = new Map(fillPlan.updates.map((u) => [u.id, u.fields]));
	const filledRows = rows.map((row) => withFills(row, fills.get(row.id)));

	const presentAids = new Set<number>();
	const heldKitsu = new Set<number>();
	for (const row of filledRows) {
		if (row.anidb_id !== null) presentAids.add(row.anidb_id);
		if (row.kitsu_id !== null) heldKitsu.add(row.kitsu_id);
	}

	const byAnidb = indexByAnidb(mappings);
	const counts: AnimeImportWork['counts'] = {
		anidbEntries: anidb.size,
		tableRows: rows.length,
		missingAids: 0,
		skippedAdult: 0,
		skippedNoMapping: 0,
		skippedNoKitsuId: 0,
		skippedKitsuHeld: 0,
		skippedKitsuShared: 0,
	};

	const pending: ImportCandidate[] = [];
	for (const entry of Array.from(anidb.values()).sort((a, b) => a.aid - b.aid)) {
		if (presentAids.has(entry.aid)) continue;
		counts.missingAids++;

		const lists = animeLists.get(entry.aid);
		if (isAdultEntry(lists)) {
			counts.skippedAdult++;
			continue;
		}
		const mapping = byAnidb.get(entry.aid);
		if (!mapping) {
			counts.skippedNoMapping++;
			continue;
		}
		if (mapping.kitsuId === null) {
			counts.skippedNoKitsuId++;
			continue;
		}
		// A row already holds this Kitsu id: either it is this title under
		// contradictory ids, which `planAnimeMappingUpdates` refuses to merge, or
		// the mapping is wrong. A second row for it would be unfindable anyway,
		// since search reads one row per Kitsu id.
		if (heldKitsu.has(mapping.kitsuId)) {
			counts.skippedKitsuHeld++;
			continue;
		}
		pending.push({ aid: entry.aid, kitsuId: mapping.kitsuId, mapping, anidb: entry, lists });
	}

	// Two missing entries mapped to one Kitsu id cannot both be findable, and
	// nothing says which is right.
	const kitsuUses = new Map<number, number>();
	for (const candidate of pending) {
		kitsuUses.set(candidate.kitsuId, (kitsuUses.get(candidate.kitsuId) ?? 0) + 1);
	}
	const candidates = pending.filter((candidate) => {
		if (kitsuUses.get(candidate.kitsuId)! > 1) {
			counts.skippedKitsuShared++;
			return false;
		}
		return true;
	});

	const enrichTargets = filledRows.filter(
		(row) =>
			(row.title === '' || row.poster_url === '') &&
			(row.kitsu_id !== null || row.anidb_id !== null) &&
			!(row.anidb_id !== null && isAdultEntry(animeLists.get(row.anidb_id)))
	);

	const kitsuIds = Array.from(
		new Set([
			...candidates.map((c) => c.kitsuId),
			...enrichTargets.filter((row) => row.kitsu_id !== null).map((row) => row.kitsu_id!),
		])
	).sort((a, b) => a - b);

	return { fillPlan, candidates, enrichTargets, kitsuIds, counts };
}

/**
 * The empty columns of one existing row, filled from Kitsu and AniDB.
 *
 * Only a row missing its title or poster is a target, and then every empty
 * column is filled at once. A rating of 0 counts as empty: the table stores
 * "no score" as 0.
 */
function enrichmentFor(
	row: AnimeImportRow,
	kitsu: KitsuImportMeta | undefined,
	anidb: AnidbEntry | undefined
): AnimeMetadataFields {
	const fields: AnimeMetadataFields = {};
	const usableKitsu = kitsu && !isKitsuAdult(kitsu) ? kitsu : undefined;

	if (row.title === '') {
		const title = anidb?.primary || usableKitsu?.canonicalTitle || '';
		if (title) fields.title = clipTitle(title);
	}
	if (aliasesAreEmpty(row.aliases)) {
		const aliases = anidb ? aliasesFor(anidb) : (usableKitsu?.titles ?? []);
		if (aliases.length > 0) fields.aliases = aliases;
	}
	if (usableKitsu) {
		if (row.poster_url === '' && fitUrl(usableKitsu.poster)) {
			fields.poster_url = fitUrl(usableKitsu.poster);
		}
		if (row.background_url === '' && fitUrl(usableKitsu.cover)) {
			fields.background_url = fitUrl(usableKitsu.cover);
		}
		if (row.description === '' && usableKitsu.synopsis) {
			fields.description = clipDescription(usableKitsu.synopsis);
		}
		if (row.rating === 0 && usableKitsu.rating > 0) fields.rating = usableKitsu.rating;
	}
	return fields;
}

/**
 * The final writes, once Kitsu has answered for `work.kitsuIds`.
 *
 * New rows join the id plan as virtual rows, so a shared IMDb id goes to the
 * first-season TV entry whether that entry already had a row or is new today.
 * They are admitted to it only after Kitsu has vouched for them: an entry that
 * claimed an id in the plan and then failed its Kitsu check would hold that id
 * away from the row it belongs to on every run.
 */
export function planAnimeImport(
	work: AnimeImportWork,
	input: {
		rows: AnimeImportRow[];
		anidb: Map<number, AnidbEntry>;
		mappings: AnimeIdMapping[];
		kitsu: Map<number, KitsuImportMeta>;
	}
): AnimeImportPlan {
	const { rows, anidb, mappings, kitsu } = input;
	let kitsuAbsent = 0;
	let kitsuAdult = 0;
	let kitsuNoPoster = 0;

	const admitted: { candidate: ImportCandidate; meta: KitsuImportMeta }[] = [];
	for (const candidate of work.candidates) {
		const meta = kitsu.get(candidate.kitsuId);
		if (!meta) {
			kitsuAbsent++;
			continue;
		}
		if (isKitsuAdult(meta)) {
			kitsuAdult++;
			continue;
		}
		if (!fitUrl(meta.poster)) {
			kitsuNoPoster++;
			continue;
		}
		admitted.push({ candidate, meta });
	}

	const virtualRows: AnimeRow[] = admitted.map(({ candidate }) => ({
		id: VIRTUAL_ID_BASE + candidate.aid,
		anidb_id: candidate.aid,
		kitsu_id: null,
		mal_id: null,
		anime_planet_id: null,
		imdb_id: null,
	}));
	const joint = planAnimeMappingUpdates([...rows, ...virtualRows], mappings);
	const jointFills = new Map(joint.updates.map((u) => [u.id, u.fields]));

	const inserts: AnimeInsert[] = [];
	let lostKitsuInPlan = 0;
	for (const { candidate, meta } of admitted) {
		const fields = jointFills.get(VIRTUAL_ID_BASE + candidate.aid) ?? {};
		if (fields.kitsu_id !== candidate.kitsuId) {
			lostKitsuInPlan++;
			continue;
		}
		inserts.push({
			anidb_id: candidate.aid,
			kitsu_id: candidate.kitsuId,
			mal_id: fields.mal_id ?? null,
			anime_planet_id: fields.anime_planet_id ?? null,
			imdb_id: fields.imdb_id ?? null,
			title: clipTitle(candidate.anidb.primary || meta.canonicalTitle),
			type: typeFor(candidate.mapping, candidate.lists, meta),
			aliases: aliasesFor(candidate.anidb),
			description: clipDescription(meta.synopsis),
			poster_url: fitUrl(meta.poster),
			background_url: fitUrl(meta.cover),
			rating: meta.rating,
			startDate: meta.startDate,
		});
	}

	const enrichTargets = new Map(work.enrichTargets.map((row) => [row.id, row]));
	const updates: AnimeImportUpdate[] = [];
	let rowsWithIdFills = 0;
	let rowsEnriched = 0;
	for (const row of rows) {
		const idFields = jointFills.get(row.id);
		const target = enrichTargets.get(row.id);
		const metadata = target
			? enrichmentFor(
					target,
					target.kitsu_id !== null ? kitsu.get(target.kitsu_id) : undefined,
					target.anidb_id !== null ? anidb.get(target.anidb_id) : undefined
				)
			: {};
		const hasIds = idFields !== undefined && Object.keys(idFields).length > 0;
		const hasMetadata = Object.keys(metadata).length > 0;
		if (!hasIds && !hasMetadata) continue;
		if (hasIds) rowsWithIdFills++;
		if (hasMetadata) rowsEnriched++;
		updates.push({ id: row.id, fields: { ...(idFields ?? {}), ...metadata } });
	}

	return {
		updates,
		inserts,
		collisions: joint.collisions,
		counts: {
			...work.counts,
			candidates: work.candidates.length,
			kitsuAbsent,
			kitsuAdult,
			kitsuNoPoster,
			lostKitsuInPlan,
			inserts: inserts.length,
			insertsWithImdb: inserts.filter((i) => i.imdb_id !== null).length,
			rowsWithIdFills,
			rowsEnriched,
			updates: updates.length,
		},
	};
}

export interface AnimeImportBackup {
	takenAt: string;
	/** Rows numbered above this were written by the run this backup precedes. */
	maxIdBefore: number;
	rowCountBefore: number;
	/** The value every updated column held before the run. */
	updates: { id: number; before: Record<string, unknown> }[];
	/** The anidb ids of the rows the run inserts. */
	insertedAnidbIds: number[];
}

/**
 * Everything needed to undo a run: put each `before` back on its row, and
 * delete the rows above `maxIdBefore` whose anidb id is listed.
 */
export function backupFor(
	plan: AnimeImportPlan,
	rows: AnimeImportRow[],
	takenAt: Date
): AnimeImportBackup {
	const byId = new Map(rows.map((row) => [row.id, row]));
	return {
		takenAt: takenAt.toISOString(),
		maxIdBefore: rows.reduce((max, row) => Math.max(max, row.id), 0),
		rowCountBefore: rows.length,
		updates: plan.updates.map((update) => {
			const row = byId.get(update.id)!;
			const before: Record<string, unknown> = {};
			for (const column of Object.keys(update.fields)) {
				before[column] = row[column as keyof AnimeImportRow];
			}
			return { id: update.id, before };
		}),
		insertedAnidbIds: plan.inserts.map((insert) => insert.anidb_id),
	};
}
