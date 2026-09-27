import {
	pairKeyOf,
	ScrapedVerdictService,
	titleKeyOf,
	type NewVerdict,
	type StoredPair,
} from '@/services/database/scrapedVerdict';
import { classifyFilenames } from './jev';
import { decide, decideWithoutModel, type Verdict } from './rules';

/**
 * Keeps movie pages free of results that are not the movie. A page view hides
 * results already judged trash and, in the background, judges whatever is new
 * on the page since its last check, so the next visit is already clean.
 *
 * Bump ENGINE when the rules or the prompt change: the checkpoint then no longer
 * matches and each page is revisited, though existing verdicts are kept and only
 * unjudged results are sent to the model.
 */
export const ENGINE = 'rules-v6.5+jev';

/** Jobs a single instance runs at once; the rest wait for a later visit. */
const MAX_CONCURRENT_JOBS = 2;
/** A lock this old belonged to a job that died. */
const LOCK_STALE_MS = 15 * 60 * 1000;
/** About $8.40 a day at $0.042 per million input tokens. */
const DEFAULT_DAILY_TOKENS = 200_000_000;

const inFlight = new Set<string>();
let service: ScrapedVerdictService | undefined;

const verdicts = () => (service ??= new ScrapedVerdictService());

function apiKey(): string | undefined {
	return process.env.TYPESAFE_API_KEY || undefined;
}

const utcDay = () => new Date().toISOString().slice(0, 10);

/**
 * Fleet-wide cap on model spend per UTC day, counted in the database. A
 * per-process counter reset on every deploy and let two deploys on 2026-09-27
 * spend past the ceiling.
 */
async function underBudget(db: ScrapedVerdictService): Promise<boolean> {
	const limit = Number(process.env.SCRAPED_VERDICTS_DAILY_TOKENS) || DEFAULT_DAILY_TOKENS;
	return (await db.getTokensSpent(utcDay())) < limit;
}

type Judged = {
	verdict: Verdict;
	rule: 'rules' | 'jev' | 'reused';
	media: string | null;
	titleMatch: string | null;
};

export type JobOutcome =
	| { status: 'skipped'; reason: string }
	| { status: 'done'; judged: number; modelTitles: number; trashed: number; inputTokens: number };

/**
 * One pass over a movie page. Exported for tests and for a manual backfill;
 * page views go through `cleanMovieResultsInBackground`.
 */
export async function judgeMoviePage(
	imdbId: string,
	db: ScrapedVerdictService = verdicts()
): Promise<JobOutcome> {
	const key = apiKey();
	if (!key) return { status: 'skipped', reason: 'no api key' };

	const pageKey = `movie:${imdbId}`;
	const startedAt = new Date();
	const { pairs, lastChanged } = await db.getStoredPairs(pageKey);
	if (pairs.length === 0) return { status: 'skipped', reason: 'empty page' };

	const checkpoint = await db.getCheckpoint(pageKey);
	if (
		checkpoint?.engine === ENGINE &&
		lastChanged !== null &&
		checkpoint.checkedAt >= lastChanged
	) {
		return { status: 'skipped', reason: 'unchanged since last check' };
	}
	if (!(await underBudget(db))) return { status: 'skipped', reason: 'daily token budget spent' };
	if (!(await db.acquireLock(pageKey, LOCK_STALE_MS))) {
		return { status: 'skipped', reason: 'another instance is on it' };
	}

	try {
		const movie = await db.getMovieContext(imdbId);
		if (!movie) {
			// Nothing to judge against. Recheck only when the page changes.
			await db.setCheckpoint(pageKey, ENGINE, startedAt);
			return { status: 'skipped', reason: 'no IMDb record' };
		}

		// A verdict depends on the filename alone, so one recorded under another
		// hash applies to every hash carrying the same filename.
		const stored = await db.getVerdicts(imdbId);
		const byPair = new Set(stored.map((v) => `${v.hash.toLowerCase()}:${v.titleKey}`));
		const byTitle = new Map(stored.map((v) => [v.titleKey, v.verdict]));

		const unjudged = pairs.filter((p) => !byPair.has(pairKeyOf(p.hash, p.title)));
		const judged = new Map<string, Judged>();
		const forModel: string[] = [];
		for (const title of new Set(unjudged.map((p) => p.title))) {
			const reused = byTitle.get(titleKeyOf(title));
			const settled = reused ?? decideWithoutModel(movie, title);
			if (settled) {
				const rule = reused ? 'reused' : 'rules';
				judged.set(title, { verdict: settled, rule, media: null, titleMatch: null });
			} else {
				forModel.push(title);
			}
		}

		let inputTokens = 0;
		let model = 'none';
		if (forModel.length > 0) {
			const result = await classifyFilenames(key, movie, forModel);
			inputTokens = result.inputTokens;
			await db.addTokensSpent(utcDay(), inputTokens);
			model = result.model;
			forModel.forEach((title, i) => {
				const { media, titleMatch } = result.answers[i];
				judged.set(title, {
					verdict: decide(movie, title, media, titleMatch),
					rule: 'jev',
					media,
					titleMatch,
				});
			});
		}

		const engine = `${ENGINE}/${model}`;
		const recorded = new Set<string>();
		const newVerdicts: NewVerdict[] = [];
		for (const pair of unjudged) {
			const id = pairKeyOf(pair.hash, pair.title);
			if (recorded.has(id)) continue; // same pair in both tables
			recorded.add(id);
			const j = judged.get(pair.title)!;
			newVerdicts.push({ imdbId, hash: pair.hash, title: pair.title, engine, ...j });
		}
		await db.saveVerdicts(newVerdicts);

		// Trash every result on the page with a trash verdict, not only the new
		// ones: a scraper may have written a trashed result back since.
		const trashVerdicts = new Map<string, string>();
		for (const v of stored)
			if (v.verdict === 'trash')
				trashVerdicts.set(`${v.hash.toLowerCase()}:${v.titleKey}`, 'reused');
		for (const v of newVerdicts)
			if (v.verdict === 'trash') trashVerdicts.set(pairKeyOf(v.hash, v.title), v.rule);
		const toTrash: (StoredPair & { rule: string })[] = [];
		for (const pair of pairs) {
			const rule = trashVerdicts.get(pairKeyOf(pair.hash, pair.title));
			if (rule) toTrash.push({ ...pair, rule });
		}
		const trashed = await db.trashPairs(pageKey, movie, toTrash, engine);

		await db.setCheckpoint(pageKey, ENGINE, startedAt);
		console.log(
			`[verdicts] ${imdbId}: judged ${newVerdicts.length} (${forModel.length} filenames by model), trashed ${trashed}, ${inputTokens} tokens`
		);
		return {
			status: 'done',
			judged: newVerdicts.length,
			modelTitles: forModel.length,
			trashed,
			inputTokens,
		};
	} finally {
		await db.releaseLock(pageKey).catch(() => {});
	}
}

/**
 * Fire-and-forget from the movie route. Never throws and never holds the
 * response; a skipped or failed pass is retried on a later visit because the
 * checkpoint only advances when a pass completes.
 */
export async function cleanMovieResultsInBackground(imdbId: string): Promise<void> {
	if (!apiKey() || inFlight.has(imdbId) || inFlight.size >= MAX_CONCURRENT_JOBS) return;
	inFlight.add(imdbId);
	try {
		await judgeMoviePage(imdbId);
	} catch (error) {
		console.warn(
			`[verdicts] ${imdbId} failed:`,
			error instanceof Error ? error.message : error
		);
	} finally {
		inFlight.delete(imdbId);
	}
}

/**
 * Hides results already judged trash, for the window between a verdict and the
 * move, and for trashed results a scraper wrote back. Serving never fails on
 * this: on any error the results pass through unfiltered.
 */
export async function withoutTrashedResults<T extends { hash?: string; title?: string }>(
	imdbId: string,
	results: T[],
	db: ScrapedVerdictService = verdicts()
): Promise<T[]> {
	if (!apiKey() || results.length === 0) return results;
	try {
		const hashes = results.flatMap((r) => (r.hash ? [r.hash] : []));
		const trashed = await db.getTrashedPairKeys(imdbId, hashes);
		if (trashed.size === 0) return results;
		return results.filter(
			(r) => !(r.hash && r.title && trashed.has(pairKeyOf(r.hash, r.title)))
		);
	} catch (error) {
		console.warn(
			'[verdicts] trash filter failed:',
			error instanceof Error ? error.message : error
		);
		return results;
	}
}
