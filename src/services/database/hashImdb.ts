import { DatabaseClient } from './client';

export interface HashImdbPair {
	hash: string;
	imdbId: string;
}

/** The title DMM matched a release hash to. */
export interface HashIdentity {
	imdbId: string;
	title: string | null;
	year: number | null;
}

type ScrapedVerdictRow = HashImdbPair & { verdict: string };

const INFO_HASH = /^[a-f0-9]{40}$/;
const IMDB_ID = /^tt\d{7,}$/;

/**
 * Which title each hash is, from the hash-to-imdbId rows DMM already holds.
 *
 * `sources` are listed most trusted first. Graded against the ScrapedVerdict
 * keep verdicts on 1,000 Real-Debrid library entries on 2026-10-03, HashImdb
 * (zurg's matches) agreed on 65 of 65 hashes, Available on 386 of 400 and
 * AvailableAd on 288 of 313. Available and AvailableAd record the page a user
 * added a release from, so a poisoned page files a release under the wrong
 * title: a pair ScrapedVerdict trashed and never kept is dropped, and a kept
 * pair beats source order.
 */
export function pickHashImdbIds(
	sources: HashImdbPair[][],
	verdicts: ScrapedVerdictRow[]
): Map<string, string> {
	const judged = new Map<string, Set<string>>();
	for (const { hash, imdbId, verdict } of verdicts) {
		const key = `${hash.toLowerCase()}|${imdbId}`;
		const seen = judged.get(key) ?? new Set<string>();
		seen.add(verdict);
		judged.set(key, seen);
	}

	const candidates = new Map<string, string[]>();
	for (const rows of sources) {
		for (const { hash, imdbId } of rows) {
			if (!IMDB_ID.test(imdbId)) continue;
			const key = hash.toLowerCase();
			const ids = candidates.get(key) ?? [];
			if (!ids.includes(imdbId)) ids.push(imdbId);
			candidates.set(key, ids);
		}
	}

	const picks = new Map<string, string>();
	for (const [hash, ids] of candidates) {
		const verdictsOf = (imdbId: string) => judged.get(`${hash}|${imdbId}`);
		const usable = ids.filter((imdbId) => {
			const seen = verdictsOf(imdbId);
			return !seen?.has('trash') || seen.has('keep');
		});
		const pick = usable.find((imdbId) => verdictsOf(imdbId)?.has('keep')) ?? usable[0];
		if (pick) picks.set(hash, pick);
	}
	return picks;
}

export class HashImdbService extends DatabaseClient {
	/**
	 * What each release in a DMM Cast library is, keyed by lowercase hash.
	 *
	 * This runs on every library catalog page a Stremio client scrolls, so every
	 * read is an indexed lookup: by hash for the three mapping tables, by
	 * (imdbId, hash) for verdicts, by tconst for titles. ScrapedVerdict has no
	 * index that starts with the hash, so a release only a verdict knows about
	 * stays unidentified rather than costing a scan of the whole table.
	 */
	public async identifyHashes(hashes: string[]): Promise<Map<string, HashIdentity>> {
		const identities = new Map<string, HashIdentity>();
		const wanted = [...new Set(hashes.map((hash) => hash.toLowerCase()))].filter((hash) =>
			INFO_HASH.test(hash)
		);
		if (wanted.length === 0) return identities;

		const select = { hash: true, imdbId: true } as const;
		const sources = await Promise.all([
			this.prisma.hashImdb.findMany({
				where: { hash: { in: wanted } },
				select,
				orderBy: { createdAt: 'asc' },
			}),
			this.prisma.available.findMany({ where: { hash: { in: wanted } }, select }),
			this.prisma.availableAd.findMany({ where: { hash: { in: wanted } }, select }),
		]);

		const imdbIds = [...new Set(sources.flat().map((row) => row.imdbId))].filter((imdbId) =>
			IMDB_ID.test(imdbId)
		);
		if (imdbIds.length === 0) return identities;

		const [verdicts, basics] = await Promise.all([
			this.prisma.scrapedVerdict.findMany({
				where: { imdbId: { in: imdbIds }, hash: { in: wanted } },
				select: { hash: true, imdbId: true, verdict: true },
			}),
			this.prisma.imdbTitleBasics.findMany({
				where: { tconst: { in: imdbIds } },
				select: { tconst: true, primaryTitle: true, startYear: true },
			}),
		]);

		const titles = new Map(basics.map((basic) => [basic.tconst, basic]));
		for (const [hash, imdbId] of pickHashImdbIds(sources, verdicts)) {
			const basic = titles.get(imdbId);
			identities.set(hash, {
				imdbId,
				title: basic?.primaryTitle ?? null,
				year: basic?.startYear ?? null,
			});
		}
		return identities;
	}

	public async upsertBatch(pairs: HashImdbPair[]) {
		const results: { id: string; created: boolean }[] = [];

		for (const { hash, imdbId } of pairs) {
			// Check if this exact hash+imdbId combo already exists
			const existing = await this.prisma.hashImdb.findFirst({
				where: { hash, imdbId },
			});

			if (existing) {
				// Same imdbId — just bump updatedAt
				await this.prisma.hashImdb.update({
					where: { id: existing.id },
					data: { updatedAt: new Date() },
				});
				results.push({ id: existing.id, created: false });
				continue;
			}

			// Different imdbId or first entry — find next available id
			const existingForHash = await this.prisma.hashImdb.findMany({
				where: { hash },
				select: { id: true },
				orderBy: { id: 'asc' },
			});

			let id: string;
			if (existingForHash.length === 0) {
				id = hash;
			} else {
				// Find the next index: hash-1, hash-2, etc.
				let maxIdx = 0;
				for (const row of existingForHash) {
					if (row.id === hash) continue;
					const suffix = row.id.slice(hash.length + 1);
					const idx = parseInt(suffix, 10);
					if (!isNaN(idx) && idx > maxIdx) {
						maxIdx = idx;
					}
				}
				id = `${hash}-${maxIdx + 1}`;
			}

			await this.prisma.hashImdb.create({
				data: { id, hash, imdbId },
			});
			results.push({ id, created: true });
		}

		return results;
	}

	public async getByHash(hash: string) {
		return this.prisma.hashImdb.findMany({
			where: { hash },
			orderBy: { createdAt: 'asc' },
		});
	}

	public async getByHashes(hashes: string[]) {
		if (hashes.length === 0) return [];
		return this.prisma.hashImdb.findMany({
			where: { hash: { in: hashes } },
			orderBy: { createdAt: 'asc' },
		});
	}
}
