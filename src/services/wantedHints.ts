import type { WantedHintRow } from '@/services/database/wantedEvents';
import type { WantedItemRow } from '@/services/database/wantedItems';
import { encryptReleaseId, hasTokenSecret } from '@/services/newznab/opaqueId';
import { grabUrl } from '@/services/newznab/search';
import { repository as db } from '@/services/repository';
import { WANTED_NZB_PREFIX } from '@/services/wantedHistory';

/** A release other sponsors' zurgs took and confirmed, as a hint carries it. */
export interface WantedKnown {
	release: string;
	torrent: boolean;
	hash?: string;
	/** The NZB's grab URL, carrying the reader's key, as `pins[].nzb` does. */
	nzb?: string;
	/** A stable id of the NZB, as `pins[].id` is. */
	id?: string;
	size: number;
	resolution: string;
	season?: number;
	episode?: number;
	pack?: boolean;
	/** Distinct other sponsors who took it. */
	taken: number;
}

/** A release at least two sponsors' zurgs found bad, with nobody confirming it since. */
export interface WantedCondemned {
	release: string;
	hash?: string;
	size?: number;
	nzb_sha?: string;
}

export interface WantedHints {
	known?: WantedKnown[];
	condemned?: WantedCondemned[];
}

const MAX_KNOWN = 10;
const MAX_CONDEMNED = 20;
/** Sponsors who must have turned a release down for it to count as bad. */
const CONDEMNED_BY = 2;
/** Kept per title and season: the reader's own takes come off before the best ten are cut. */
const KEPT = MAX_KNOWN * 2;
/** IMDb ids a read asks about at once. */
const CHUNK = 1000;
/**
 * How long a title's releases are reused, across sponsors and polls. A zurg reads
 * its list every few minutes and a list holds up to 10,000 titles; with this a
 * replica reads each title's events at most once in ten minutes.
 */
const REUSED_FOR_MS = 10 * 60_000;

const HASH = /^[0-9a-f]{40}$/;

interface Release extends WantedHintRow {
	condemned: boolean;
	/** An NZB's grab token, minted once: it is the same for every reader. */
	token?: string;
}

const cache = new Map<string, { until: number; releases: Release[] }>();

/** Test-only. */
export function _resetWantedHintsForTest(): void {
	cache.clear();
}

/** What is worth keeping of one title's rows: its bad releases and each season's most taken. */
function digest(rows: WantedHintRow[]): Release[] {
	const releases = rows.map((row) => ({
		...row,
		condemned:
			row.refused >= CONDEMNED_BY && (!row.lastTaken || row.lastTaken < row.lastRefused!),
	}));
	// Both kinds are kept by season, since a reader may want only some of a show's.
	const known = new Map<number | null, Release[]>();
	const condemned = new Map<number | null, Release[]>();
	for (const r of releases) {
		// A torrent needs only its hash; an NZB one DMM can serve: its own, or an upload it holds.
		const servable = HASH.test(r.ref) || r.ref.includes(':') || r.held;
		if (!r.condemned && (r.taken < 1 || !servable)) continue;
		const into = r.condemned ? condemned : known;
		into.set(r.season, [...(into.get(r.season) ?? []), r]);
	}
	return [
		...[...condemned.values()].flatMap((season) =>
			season.sort((a, b) => b.refused - a.refused).slice(0, MAX_CONDEMNED)
		),
		...[...known.values()].flatMap((season) =>
			season.sort((a, b) => b.taken - a.taken).slice(0, KEPT)
		),
	];
}

async function releasesOf(imdbIds: string[], now: number): Promise<Map<string, Release[]>> {
	const out = new Map<string, Release[]>();
	const missing: string[] = [];
	for (const imdbId of new Set(imdbIds)) {
		const hit = cache.get(imdbId);
		if (hit && hit.until > now) out.set(imdbId, hit.releases);
		else missing.push(imdbId);
	}
	for (let i = 0; i < missing.length; i += CHUNK) {
		const chunk = missing.slice(i, i + CHUNK);
		const byTitle = new Map<string, WantedHintRow[]>();
		for (const row of await db.wantedHintRows(chunk)) {
			byTitle.set(row.imdbId, [...(byTitle.get(row.imdbId) ?? []), row]);
		}
		// ponytail: drops everything at the bound instead of evicting the oldest, as resolvedTitles does
		if (cache.size >= 50_000) cache.clear();
		for (const imdbId of chunk) {
			const releases = digest(byTitle.get(imdbId) ?? []);
			cache.set(imdbId, { until: now + REUSED_FOR_MS, releases });
			out.set(imdbId, releases);
		}
	}
	return out;
}

function knownOf(r: Release, taken: number, apiKey: string): WantedKnown | null {
	const about = {
		size: r.size ?? 0,
		resolution: r.resolution,
		...(r.season !== null && { season: r.season }),
		...(r.episode !== null && { episode: r.episode }),
		taken,
	};
	if (HASH.test(r.ref)) {
		return { release: r.release, torrent: true, hash: r.ref, ...about, pack: r.pack };
	}
	if (!hasTokenSecret()) return null;
	const split = r.ref.indexOf(':');
	r.token ??=
		split === -1
			? encryptReleaseId(WANTED_NZB_PREFIX, r.ref)
			: encryptReleaseId(r.ref.slice(0, split), r.ref.slice(split + 1));
	// The token hides which upstream a release is from; a sha names nobody.
	return {
		release: r.release,
		torrent: false,
		nzb: grabUrl(r.token, apiKey),
		id: r.nzb ?? r.token,
		...about,
	};
}

/**
 * Hints for a sponsor's wanted titles, by item id: what other sponsors' zurgs took
 * and confirmed for the same title (`known`), and what they found bad (`condemned`).
 * A hint names a release and how many took it, never who, and never an indexer.
 * Titles nobody reported on are absent.
 */
export async function wantedHints(
	rows: WantedItemRow[],
	shortId: string,
	apiKey: string,
	now = Date.now()
): Promise<Map<string, WantedHints>> {
	const releases = await releasesOf(
		rows.map((row) => row.imdbId),
		now
	);
	const out = new Map<string, WantedHints>();
	for (const row of rows) {
		const wanted = (r: Release) =>
			row.kind === 'movie' ||
			!row.seasons ||
			(r.season !== null && row.seasons.includes(r.season));
		const all = (releases.get(row.imdbId) ?? []).filter(wanted);
		if (!all.length) continue;

		const perSeason = new Map<number | null, WantedKnown[]>();
		for (const r of all) {
			if (r.condemned) continue;
			// ponytail: MySQL cuts the list of takers at 1,024 bytes (about 60 sponsors); past that the reader's own take may stay counted, one in sixty or more
			const taken = r.taken - (r.takers.includes(shortId) ? 1 : 0);
			const known = taken > 0 ? knownOf(r, taken, apiKey) : null;
			if (known) perSeason.set(r.season, [...(perSeason.get(r.season) ?? []), known]);
		}
		const known = [...perSeason.values()].flatMap((season) =>
			season.sort((a, b) => b.taken - a.taken).slice(0, MAX_KNOWN)
		);
		const condemned = all
			.filter((r) => r.condemned)
			.sort((a, b) => b.refused - a.refused)
			.slice(0, MAX_CONDEMNED)
			.map((r): WantedCondemned =>
				HASH.test(r.ref)
					? { release: r.release, hash: r.ref }
					: { release: r.release, size: r.size ?? 0, ...(r.nzb && { nzb_sha: r.nzb }) }
			);
		if (known.length || condemned.length) {
			out.set(row.id, {
				...(known.length && { known }),
				...(condemned.length && { condemned }),
			});
		}
	}
	return out;
}
