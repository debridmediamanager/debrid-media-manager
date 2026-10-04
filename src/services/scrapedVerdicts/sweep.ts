// Moves results that already have a trash verdict off the movie pages a
// scraper has written them back to, from the cron rather than from a page
// view.
//
// A trash verdict moves its result into ScrapedTrash when a page view runs the
// verdict pass, and a scraper that finds the release again merges it back into
// the page. The page view hides it again, but nothing
// moves it until somebody views the page while the day's model budget lasts,
// and the budget was spent every day from 2026-09-28 to 2026-10-03. Until then
// the Torznab feed, the Stremio addons and every other reader of the page serve
// it. On 2026-10-04, 27 of 393 randomly drawn judged ScrapedTrue movie pages
// carried 137 such results, and every one of the 33 on the four pages recorded
// in `__fixtures__/written-back-trash.json` had been moved to ScrapedTrash
// before.
//
// Nothing here asks the model or records a verdict: it reads the verdicts the
// page view recorded and moves only what they already trash, through the same
// locked `trashPairs` the page view uses. It does not advance the page's
// checkpoint either, so results the scrapers added that have no verdict yet are
// still judged on the next view.

import {
	pairKeyOf,
	ScrapedVerdictService,
	type PageChange,
	type ScrapedSource,
} from '@/services/database/scrapedVerdict';
import { ENGINE } from './job';

/** Pages read from each table per tick. The cron fires every five minutes. */
export const SWEEP_BATCH = 200;

/**
 * How long a page's change is left to settle before the sweep reads past it.
 * A writer stamps `updatedAt` before it commits, so a page can appear with a
 * timestamp the sweep has already passed. Two minutes also covers the clock
 * difference between the replicas that stamp it.
 */
export const SWEEP_SETTLE_MS = 2 * 60 * 1000;

/**
 * Where the sweep starts on its first tick: the first verdicts were recorded
 * on 2026-09-27, so nothing was trashed, and nothing written back, before. A
 * page changed since then and judged at some point is read once.
 */
export const SWEEP_START: PageChange = { key: '', at: new Date('2026-09-27T00:00:00Z') };

const SWEEP_LOCK = 'sweep';
/** A sweep lock this old belonged to a tick that died. */
const LOCK_STALE_MS = 15 * 60 * 1000;
const SOURCES: ScrapedSource[] = ['ScrapedTrue', 'Scraped'];

export type SweepResult =
	| { status: 'skipped'; reason: string }
	| { status: 'done'; pages: number; judgedPages: number; moved: number; failed: number };

/** Moves one page's results that already carry a trash verdict. Returns how many moved. */
export async function moveTrashedResults(
	imdbId: string,
	db: ScrapedVerdictService
): Promise<number> {
	const pageKey = `movie:${imdbId}`;
	const { pairs } = await db.getStoredPairs(pageKey);
	if (pairs.length === 0) return 0;
	const trashed = await db.getTrashedPairKeys(
		imdbId,
		pairs.map((p) => p.hash)
	);
	const toTrash = pairs
		.filter((p) => trashed.has(pairKeyOf(p.hash, p.title)))
		.map((p) => ({ ...p, rule: 'reused' }));
	if (toTrash.length === 0) return 0;
	const name = (await db.getMovieName(imdbId)) ?? imdbId;
	return db.trashPairs(pageKey, { imdbId, name }, toTrash, `${ENGINE}/sweep`);
}

/**
 * One tick: the movie pages either table changed since the last tick, the ones
 * with verdicts among them, and their trashed results moved. A page that fails
 * is counted and left for its next change; the Torznab feed and the movie page
 * hide its trashed results meanwhile.
 */
export async function sweepWrittenBackTrash(
	db: ScrapedVerdictService = new ScrapedVerdictService()
): Promise<SweepResult> {
	// The same switch that turns the verdicts off everywhere else.
	if (!process.env.TYPESAFE_API_KEY) return { status: 'skipped', reason: 'no api key' };
	if (!(await db.acquireLock(SWEEP_LOCK, LOCK_STALE_MS))) {
		return { status: 'skipped', reason: 'another instance is on it' };
	}
	try {
		const settledBefore = new Date(Date.now() - SWEEP_SETTLE_MS);
		const changed = new Map<ScrapedSource, PageChange[]>();
		for (const source of SOURCES) {
			const after = (await db.getSweepCursor(source)) ?? SWEEP_START;
			changed.set(
				source,
				await db.getChangedMoviePages(source, after, settledBefore, SWEEP_BATCH)
			);
		}

		const imdbIds = new Set<string>();
		for (const pages of changed.values()) {
			for (const { key } of pages) {
				const match = /^movie:(tt\d+)$/.exec(key);
				if (match) imdbIds.add(match[1]);
			}
		}
		const judged = await db.getJudgedImdbIds([...imdbIds]);

		let moved = 0;
		let failed = 0;
		for (const imdbId of judged) {
			try {
				moved += await moveTrashedResults(imdbId, db);
			} catch (error) {
				failed++;
				console.warn(
					`[verdicts] sweep of ${imdbId} failed:`,
					error instanceof Error ? error.message : error
				);
			}
		}

		for (const [source, pages] of changed) {
			const last = pages.at(-1);
			if (last) await db.setSweepCursor(source, last);
		}
		if (moved > 0 || failed > 0) {
			console.log(
				`[verdicts] sweep: ${imdbIds.size} changed pages, ${judged.size} judged, moved ${moved}, ${failed} failed`
			);
		}
		return { status: 'done', pages: imdbIds.size, judgedPages: judged.size, moved, failed };
	} finally {
		await db.releaseLock(SWEEP_LOCK).catch(() => {});
	}
}
