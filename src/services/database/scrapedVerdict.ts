import type { MovieContext, Verdict } from '@/services/scrapedVerdicts/rules';
import { fold } from '@/services/scrapedVerdicts/rules';
import { isMovieTitleType } from '@/utils/imdbTitleTypes';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { DatabaseClient } from './client';

export type ScrapedSource = 'ScrapedTrue' | 'Scraped';

export type StoredPair = {
	source: ScrapedSource;
	hash: string;
	title: string;
	fileSize: number | null;
};

export type StoredVerdict = {
	hash: string;
	titleKey: string;
	verdict: Verdict;
};

export type NewVerdict = {
	imdbId: string;
	hash: string;
	title: string;
	verdict: Verdict;
	rule: 'rules' | 'jev' | 'reused';
	media: string | null;
	titleMatch: string | null;
	engine: string;
};

type StoredEntry = { hash?: unknown; title?: unknown; fileSize?: unknown };

/** The verdict depends on the filename, so it is keyed by a digest of it. */
export const titleKeyOf = (title: string): string =>
	createHash('sha1').update(title, 'utf8').digest('hex');

export const pairKeyOf = (hash: string, title: string): string =>
	`${hash.toLowerCase()}:${titleKeyOf(title)}`;

const LOCK_PREFIX = 'verdicts:lock:';
const CHECKPOINT_PREFIX = 'verdicts:checked:';
const TOKENS_PREFIX = 'verdicts:tokens:';
const SWEEP_PREFIX = 'verdicts:sweep:';

/** A page and when it last changed: a position in a table read oldest change first. */
export type PageChange = { key: string; at: Date };

function entriesOf(value: Prisma.JsonValue | undefined): StoredEntry[] {
	return Array.isArray(value) ? (value as StoredEntry[]) : [];
}

/** Boolean-mode fulltext treats these as operators, so they cannot appear in a phrase. */
const phraseOf = (title: string) => title.replace(/[+\-<>()~*@"]/g, ' ').trim();

export class ScrapedVerdictService extends DatabaseClient {
	/**
	 * Everything the rules need to know about a movie, from the IMDb dataset
	 * tables: its year, every title it is known by, and which of its alternative
	 * titles are also another work's primary title. `null` when IMDb has no
	 * usable record, in which case the page is left alone.
	 */
	public async getMovieContext(imdbId: string): Promise<MovieContext | null> {
		const basics = await this.prisma.imdbTitleBasics.findUnique({
			where: { tconst: imdbId },
			select: { primaryTitle: true, originalTitle: true, startYear: true, titleType: true },
		});
		if (!basics?.primaryTitle || !basics.startYear) return null;
		// A movie verdict means nothing for a series: on 2026-09-27 the episodes
		// filed under movie:tt28959685 (Love Island: All Stars) were all trashed.
		if (!isMovieTitleType(basics.titleType)) return null;

		const akas = await this.prisma.imdbTitleAkas.findMany({
			where: { titleId: imdbId },
			select: { title: true },
		});
		// Matching ignores case and accents, so "Sueños de Libertad" next to
		// "Sueños de libertad" would only add prompt tokens. One spelling each.
		const byFold = new Map<string, string>();
		for (const title of [basics.primaryTitle, basics.originalTitle, ...akas.map((a) => a.title)]
			.filter((t): t is string => !!t && t.trim().length > 0)
			.sort()) {
			const folded = fold(title).trim() || title;
			if (!byFold.has(folded)) byFold.set(folded, title);
		}
		const titles = [...byFold.values()];

		const primary = fold(basics.primaryTitle).trim();
		const aliases = new Set(titles.map((t) => fold(t).trim()).filter((t) => t !== primary));
		const phrases = [...new Set(titles.map(phraseOf))].filter((p) => p.length >= 3);
		const ambiguous: Record<string, number[]> = {};
		if (phrases.length > 0 && aliases.size > 0) {
			const against = phrases.map((p) => `"${p}"`).join(' ');
			const others = await this.prisma.$queryRaw<
				{ primary_title: string; start_year: number }[]
			>(Prisma.sql`
				SELECT primary_title, start_year FROM imdb_title_basics
				WHERE MATCH(primary_title) AGAINST(${against} IN BOOLEAN MODE)
				  AND tconst <> ${imdbId}
				  AND title_type NOT IN ('tvEpisode', 'videoGame')
				  AND start_year IS NOT NULL
				LIMIT 5000`);
			for (const other of others) {
				const folded = fold(other.primary_title).trim();
				if (!aliases.has(folded)) continue;
				const years = (ambiguous[folded] ??= []);
				const year = Number(other.start_year);
				if (!years.includes(year)) years.push(year);
			}
			for (const years of Object.values(ambiguous)) years.sort((a, b) => a - b);
		}

		return {
			imdbId,
			name: basics.primaryTitle,
			year: basics.startYear,
			titles,
			ambiguous,
		};
	}

	/** Every stored result for a page key across both tables, whole, plus when either last changed. */
	public async getStoredPairs(
		key: string
	): Promise<{ pairs: StoredPair[]; lastChanged: Date | null }> {
		const [trusted, untrusted] = await Promise.all([
			this.prisma.scrapedTrue.findUnique({ where: { key } }),
			this.prisma.scraped.findUnique({ where: { key } }),
		]);
		const pairs: StoredPair[] = [];
		for (const [source, row] of [
			['ScrapedTrue', trusted],
			['Scraped', untrusted],
		] as const) {
			for (const entry of entriesOf(row?.value)) {
				if (typeof entry.hash !== 'string' || typeof entry.title !== 'string') continue;
				pairs.push({
					source,
					hash: entry.hash.toLowerCase(),
					title: entry.title,
					fileSize: typeof entry.fileSize === 'number' ? entry.fileSize : null,
				});
			}
		}
		const times = [trusted?.updatedAt, untrusted?.updatedAt].filter((d): d is Date => !!d);
		const lastChanged = times.length
			? new Date(Math.max(...times.map((d) => d.getTime())))
			: null;
		return { pairs, lastChanged };
	}

	public async getVerdicts(imdbId: string): Promise<StoredVerdict[]> {
		const rows = await this.prisma.scrapedVerdict.findMany({
			where: { imdbId },
			select: { hash: true, titleKey: true, verdict: true },
		});
		return rows.map((r) => ({ ...r, verdict: r.verdict as Verdict }));
	}

	public async saveVerdicts(verdicts: NewVerdict[]): Promise<void> {
		for (let i = 0; i < verdicts.length; i += 1000) {
			await this.prisma.scrapedVerdict.createMany({
				data: verdicts.slice(i, i + 1000).map((v) => ({
					...v,
					hash: v.hash.toLowerCase(),
					titleKey: titleKeyOf(v.title),
				})),
				skipDuplicates: true,
			});
		}
	}

	/**
	 * Moves results off a page into ScrapedTrash. Each table's row is locked
	 * while it is rewritten so a concurrent save cannot interleave, and its
	 * `updatedAt` is preserved: it means "when the scrapers last refreshed this
	 * title", which the Torznab feed publishes and this job's own checkpoint
	 * reads. Returns how many entries were actually removed.
	 */
	public async trashPairs(
		key: string,
		movie: { imdbId: string; name: string },
		pairs: (StoredPair & { rule: string })[],
		engine: string
	): Promise<number> {
		if (pairs.length === 0) return 0;
		const wanted = new Map(pairs.map((p) => [`${p.source}|${pairKeyOf(p.hash, p.title)}`, p]));

		return this.prisma.$transaction(
			async (tx) => {
				const removed: (StoredPair & { rule: string })[] = [];
				for (const source of ['ScrapedTrue', 'Scraped'] as const) {
					if (!pairs.some((p) => p.source === source)) continue;
					const table = Prisma.raw(`\`${source}\``);
					const rows = await tx.$queryRaw<{ value: Prisma.JsonValue; updatedAt: Date }[]>(
						Prisma.sql`SELECT value, updatedAt FROM ${table} WHERE \`key\` = ${key} FOR UPDATE`
					);
					if (rows.length === 0) continue;
					const entries = entriesOf(rows[0].value);
					const kept = entries.filter((entry) => {
						if (typeof entry.hash !== 'string' || typeof entry.title !== 'string')
							return true;
						const match = wanted.get(`${source}|${pairKeyOf(entry.hash, entry.title)}`);
						if (match) removed.push(match);
						return !match;
					});
					if (kept.length === entries.length) continue;
					await tx.$executeRaw(
						Prisma.sql`UPDATE ${table} SET value = ${JSON.stringify(kept)}, updatedAt = ${rows[0].updatedAt} WHERE \`key\` = ${key}`
					);
				}
				if (removed.length > 0) {
					await tx.scrapedTrash.createMany({
						data: removed.map((p) => ({
							source: p.source,
							key,
							imdbId: movie.imdbId,
							movieTitle: movie.name.slice(0, 500),
							hash: p.hash,
							title: p.title,
							fileSize: p.fileSize,
							rule: p.rule,
							engine,
						})),
					});
				}
				return removed.length;
			},
			{ timeout: 30_000 }
		);
	}

	/**
	 * Undoes trash: puts the entries back on their pages (unless a scraper
	 * already wrote them back), deletes the trash rows, and deletes their
	 * verdicts so the next pass judges them afresh. Returns how many entries
	 * went back onto a page.
	 */
	public async restoreTrash(ids: number[]): Promise<number> {
		if (ids.length === 0) return 0;
		const rows = await this.prisma.scrapedTrash.findMany({ where: { id: { in: ids } } });
		const byPage = new Map<string, typeof rows>();
		for (const row of rows) {
			const page = `${row.source}|${row.key}`;
			byPage.set(page, [...(byPage.get(page) ?? []), row]);
		}

		let restored = 0;
		for (const pageRows of byPage.values()) {
			const { source, key } = pageRows[0];
			if (source !== 'ScrapedTrue' && source !== 'Scraped') continue;
			const table = Prisma.raw(`\`${source}\``);
			restored += await this.prisma.$transaction(
				async (tx) => {
					const current = await tx.$queryRaw<
						{ value: Prisma.JsonValue; updatedAt: Date }[]
					>(
						Prisma.sql`SELECT value, updatedAt FROM ${table} WHERE \`key\` = ${key} FOR UPDATE`
					);
					const entries = entriesOf(current[0]?.value);
					const present = new Set(
						entries.flatMap((e) =>
							typeof e.hash === 'string' && typeof e.title === 'string'
								? [pairKeyOf(e.hash, e.title)]
								: []
						)
					);
					const missing = pageRows.filter(
						(r) => !present.has(pairKeyOf(r.hash, r.title))
					);
					if (missing.length > 0) {
						const value = JSON.stringify([
							...entries,
							...missing.map((r) => ({
								hash: r.hash,
								title: r.title,
								fileSize: r.fileSize,
							})),
						]);
						if (current.length > 0) {
							await tx.$executeRaw(
								Prisma.sql`UPDATE ${table} SET value = ${value}, updatedAt = ${current[0].updatedAt} WHERE \`key\` = ${key}`
							);
						} else {
							await tx.$executeRaw(
								Prisma.sql`INSERT INTO ${table} (\`key\`, value, updatedAt) VALUES (${key}, ${value}, NOW(3))`
							);
						}
					}
					await tx.scrapedTrash.deleteMany({
						where: { id: { in: pageRows.map((r) => r.id) } },
					});
					// One statement: deleting row by row held the transaction past
					// its timeout on a 967-entry page.
					await tx.scrapedVerdict.deleteMany({
						where: {
							OR: pageRows.map((r) => ({
								imdbId: r.imdbId,
								hash: r.hash,
								titleKey: titleKeyOf(r.title),
							})),
						},
					});
					return missing.length;
				},
				{ timeout: 30_000 }
			);
		}
		return restored;
	}

	/** `hash:titleKey` for each of these results that already has a trash verdict. */
	public async getTrashedPairKeys(imdbId: string, hashes: string[]): Promise<Set<string>> {
		if (hashes.length === 0) return new Set();
		const rows = await this.prisma.scrapedVerdict.findMany({
			where: {
				imdbId,
				verdict: 'trash',
				hash: { in: [...new Set(hashes.map((h) => h.toLowerCase()))] },
			},
			select: { hash: true, titleKey: true },
		});
		return new Set(rows.map((r) => `${r.hash.toLowerCase()}:${r.titleKey}`));
	}

	/**
	 * Movie pages of one table that changed after `after`, oldest change first,
	 * leaving out any that changed after `settledBefore`. Ties on the timestamp
	 * are broken by key, so a batch that ends inside a tie resumes inside it.
	 * The table has no index on `updatedAt`; on 2026-10-04 this read took about
	 * a second, as the Torznab feed's own read of the newest pages does.
	 */
	public async getChangedMoviePages(
		source: ScrapedSource,
		after: PageChange,
		settledBefore: Date,
		limit: number
	): Promise<PageChange[]> {
		const table = Prisma.raw(`\`${source}\``);
		const rows = await this.prisma.$queryRaw<{ key: string; updatedAt: Date }[]>(Prisma.sql`
			SELECT \`key\`, updatedAt FROM ${table}
			WHERE \`key\` LIKE 'movie:tt%'
			  AND (updatedAt > ${after.at} OR (updatedAt = ${after.at} AND \`key\` > ${after.key}))
			  AND updatedAt <= ${settledBefore}
			ORDER BY updatedAt, \`key\`
			LIMIT ${limit}`);
		return rows.map((row) => ({ key: row.key, at: row.updatedAt }));
	}

	/** Which of these movies have any verdict at all. Reads the index only. */
	public async getJudgedImdbIds(imdbIds: string[]): Promise<Set<string>> {
		if (imdbIds.length === 0) return new Set();
		const rows = await this.prisma.$queryRaw<{ imdbId: string }[]>(Prisma.sql`
			SELECT imdbId FROM ScrapedVerdict
			WHERE imdbId IN (${Prisma.join(imdbIds)})
			GROUP BY imdbId`);
		return new Set(rows.map((row) => row.imdbId));
	}

	/** IMDb's primary title, which a trash record names the movie by. */
	public async getMovieName(imdbId: string): Promise<string | null> {
		const basics = await this.prisma.imdbTitleBasics.findUnique({
			where: { tconst: imdbId },
			select: { primaryTitle: true },
		});
		return basics?.primaryTitle ?? null;
	}

	/** Where the written-back trash sweep stopped in one table. */
	public async getSweepCursor(source: ScrapedSource): Promise<PageChange | null> {
		const row = await this.prisma.cache.findUnique({ where: { key: SWEEP_PREFIX + source } });
		const value = row?.value as { key?: unknown; at?: unknown } | undefined;
		if (typeof value?.key !== 'string' || typeof value.at !== 'string') return null;
		return { key: value.key, at: new Date(value.at) };
	}

	public async setSweepCursor(source: ScrapedSource, cursor: PageChange): Promise<void> {
		const value = { key: cursor.key, at: cursor.at.toISOString() };
		await this.prisma.cache.upsert({
			where: { key: SWEEP_PREFIX + source },
			update: { value },
			create: { key: SWEEP_PREFIX + source, value },
		});
	}

	/** Model input tokens spent on `day` (YYYY-MM-DD, UTC) across every instance. */
	public async getTokensSpent(day: string): Promise<number> {
		const row = await this.prisma.cache.findUnique({ where: { key: TOKENS_PREFIX + day } });
		const tokens = (row?.value as { tokens?: unknown } | undefined)?.tokens;
		return typeof tokens === 'number' ? tokens : 0;
	}

	/** Atomic, so concurrent passes on four instances cannot lose each other's spend. */
	public async addTokensSpent(day: string, tokens: number): Promise<void> {
		if (tokens <= 0) return;
		await this.prisma.$executeRaw(Prisma.sql`
			INSERT INTO Cache (\`key\`, value, updatedAt)
			VALUES (${TOKENS_PREFIX + day}, JSON_OBJECT('tokens', ${tokens}), NOW(3))
			ON DUPLICATE KEY UPDATE
				value = JSON_OBJECT('tokens', COALESCE(JSON_EXTRACT(value, '$.tokens'), 0) + ${tokens}),
				updatedAt = NOW(3)`);
	}

	public async getCheckpoint(key: string): Promise<{ engine: string; checkedAt: Date } | null> {
		const row = await this.prisma.cache.findUnique({ where: { key: CHECKPOINT_PREFIX + key } });
		const value = row?.value as { engine?: unknown; checkedAt?: unknown } | undefined;
		if (typeof value?.engine !== 'string' || typeof value.checkedAt !== 'string') return null;
		return { engine: value.engine, checkedAt: new Date(value.checkedAt) };
	}

	public async setCheckpoint(key: string, engine: string, checkedAt: Date): Promise<void> {
		const value = { engine, checkedAt: checkedAt.toISOString() };
		await this.prisma.cache.upsert({
			where: { key: CHECKPOINT_PREFIX + key },
			update: { value },
			create: { key: CHECKPOINT_PREFIX + key, value },
		});
	}

	/**
	 * A cross-instance lock so four Swarm replicas serving the same page do not
	 * judge it four times. A lock older than `staleMs` belonged to a job that
	 * died and is taken over.
	 *
	 * The lock row is written with `createMany` and `skipDuplicates`, which is
	 * MySQL's `INSERT IGNORE`: a held lock answers a count of 0 rather than a
	 * unique-key error. A plain `create` that caught P2002 behaved the same, but
	 * Prisma prints every failed query from its own error log before the caller
	 * sees it, so each contended lock printed an "Invalid `prisma.cache.create()`
	 * invocation" block (11 between 13:35 and 16:44 UTC on 2026-10-07).
	 */
	public async acquireLock(key: string, staleMs: number): Promise<boolean> {
		const lockKey = LOCK_PREFIX + key;
		// `IGNORE` also turns an over-long key into a truncated insert instead of
		// an error, which would take a lock nobody could release by name. `key` is
		// varchar(191).
		if (lockKey.length > 191) throw new Error(`Lock key too long: ${lockKey.length} chars`);
		const { count } = await this.prisma.cache.createMany({
			data: [{ key: lockKey, value: {} }],
			skipDuplicates: true,
		});
		if (count === 1) return true;
		const takeover = await this.prisma.cache.updateMany({
			where: { key: lockKey, updatedAt: { lt: new Date(Date.now() - staleMs) } },
			data: { value: {} },
		});
		return takeover.count === 1;
	}

	public async releaseLock(key: string): Promise<void> {
		await this.prisma.cache.deleteMany({ where: { key: LOCK_PREFIX + key } });
	}
}
