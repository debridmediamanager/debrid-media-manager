import type { MovieContext, Verdict } from '@/services/scrapedVerdicts/rules';
import { fold } from '@/services/scrapedVerdicts/rules';
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
			select: { primaryTitle: true, originalTitle: true, startYear: true },
		});
		if (!basics?.primaryTitle || !basics.startYear) return null;

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
				  AND title_type <> 'tvEpisode'
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
	 */
	public async acquireLock(key: string, staleMs: number): Promise<boolean> {
		const lockKey = LOCK_PREFIX + key;
		try {
			await this.prisma.cache.create({ data: { key: lockKey, value: {} } });
			return true;
		} catch (error) {
			if (
				!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
			) {
				throw error;
			}
		}
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
