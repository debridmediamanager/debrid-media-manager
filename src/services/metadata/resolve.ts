import { getMetadataCache } from '@/services/metadataCache';
import type { MetadataRecord } from '@/utils/metadataRecord';
import { getTmdbAuth } from '@/utils/tmdbAuth';
import { getMetadata, settle } from './index';

/**
 * A parsed release name — title, year, movie or show — resolved to one IMDb id,
 * or to none when the providers cannot say which title it is.
 *
 * Taking any single provider's first search result is how the uploaders named
 * files before: mdblist's first answer for "Saw IV" (2007) is Saw III, and
 * OMDb's exact-title lookup for "Dune" is the 1984 film. So candidates come from
 * TMDB and Trakt searches (and OMDb's lookup), every candidate is checked against
 * its canonical record — whose year is the original release, not OMDb's US one,
 * and whose aliases include the retitles and original-language names — and a
 * match needs the title exactly, not approximately.
 */

export type ResolveQuery = { title: string; year?: number; type?: 'movie' | 'show' };

export type ResolveConfidence =
	/** Title and year match one title. */
	| 'exact'
	/** Title matches one title; no year was given. */
	| 'title'
	/** Title matches and the year is one off (festival vs release). */
	| 'near'
	/** Several titles match equally well. */
	| 'ambiguous'
	| 'none';

export type ResolveCandidate = {
	imdbId: string;
	title: string;
	year: number | null;
	type: 'movie' | 'show';
	/** Which searches proposed it. */
	votes: number;
};

export type ResolveResult = {
	match: ResolveCandidate | null;
	confidence: ResolveConfidence;
	candidates: ResolveCandidate[];
};

const ROMAN: Record<string, string> = {
	ii: '2',
	iii: '3',
	iv: '4',
	v: '5',
	vi: '6',
	vii: '7',
	viii: '8',
	ix: '9',
	x: '10',
};

/**
 * A title reduced to what release names keep of it: no accents, case,
 * punctuation or leading article, "&" read as "and", and a trailing Roman
 * numeral read as its number (release names write both "Saw.IV" and "Saw.4").
 */
export function normalizeTitle(title: string): string {
	const words = title
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/['’`]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.split(' ')
		.filter(Boolean)
		.map((word) => ROMAN[word] ?? word);
	if (words[0] === 'the' || words[0] === 'a' || words[0] === 'an') words.shift();
	return words.join(' ');
}

const titlesOf = (record: Exclude<MetadataRecord, { type: 'episode' }>) =>
	[record.title, record.originalTitle, ...record.aliases].filter((t): t is string => !!t);

/** The IMDb ids each search proposes, most relevant first, with how many proposed each. */
export async function gatherCandidateIds(query: ResolveQuery): Promise<Map<string, number>> {
	const cache = getMetadataCache();
	const kinds: Array<'movie' | 'show'> = query.type ? [query.type] : ['movie', 'show'];
	const wanted = normalizeTitle(query.title);
	const votes = new Map<string, number>();
	const vote = (imdbId: unknown) => {
		if (typeof imdbId === 'string' && /^tt\d+$/.test(imdbId)) {
			votes.set(imdbId, (votes.get(imdbId) ?? 0) + 1);
		}
	};

	await Promise.all(
		kinds.map(async (kind) => {
			const [tmdb, trakt, omdb] = await Promise.all([
				getTmdbAuth()
					? settle(() =>
							cache.searchTmdbTitles(
								kind === 'movie' ? 'movie' : 'tv',
								query.title,
								query.year
							)
						)
					: null,
				settle(() => cache.searchTraktTitles(kind, query.title, query.year)),
				settle(() =>
					cache.getOmdbByTitle(query.title, kind === 'movie' ? 'movie' : 'series')
				),
			]);

			for (const hit of (trakt ?? []).slice(0, 5)) vote(hit?.[kind]?.ids?.imdb);
			vote(omdb?.imdbID);

			// TMDB search results carry no IMDb id; only the ones whose title
			// already matches are worth the id lookup.
			const results: any[] = Array.isArray(tmdb?.results) ? tmdb.results.slice(0, 5) : [];
			const matching = results.filter((r) =>
				[r?.title, r?.name, r?.original_title, r?.original_name].some(
					(t) => typeof t === 'string' && normalizeTitle(t) === wanted
				)
			);
			const ids = await Promise.all(
				matching.map((r) =>
					settle(() => cache.getTmdbExternalIds(r.id, kind === 'movie' ? 'movie' : 'tv'))
				)
			);
			for (const external of ids) vote(external?.imdb_id);
		})
	);
	return votes;
}

/**
 * Picks the match out of candidates already checked against their canonical
 * records. Pure, so the rules can be tested on captured provider answers.
 */
export function pickResolution(
	query: ResolveQuery,
	records: Array<{ record: MetadataRecord; votes: number }>
): ResolveResult {
	const wanted = normalizeTitle(query.title);
	const candidates: Array<ResolveCandidate & { diff: number | null }> = [];
	const seen = new Set<string>();

	for (const { record, votes } of records) {
		if (record.type === 'episode') continue;
		if (query.type && record.type !== query.type) continue;
		if (!titlesOf(record).some((t) => normalizeTitle(t) === wanted)) continue;
		const diff = query.year && record.year ? Math.abs(record.year - query.year) : null;
		if (query.year && (diff === null || diff > 1)) continue;
		const existing = candidates.find((c) => c.imdbId === record.imdbId);
		if (existing) {
			existing.votes += votes;
			continue;
		}
		if (seen.has(record.imdbId)) continue;
		seen.add(record.imdbId);
		candidates.push({
			imdbId: record.imdbId,
			title: record.title,
			year: record.year,
			type: record.type,
			votes,
			diff,
		});
	}

	const strip = ({ diff: _diff, ...candidate }: (typeof candidates)[number]) => candidate;
	const byVotes = (a: { votes: number }, b: { votes: number }) => b.votes - a.votes;
	const exact = candidates.filter((c) => c.diff === 0).sort(byVotes);
	const near = candidates.filter((c) => c.diff === 1).sort(byVotes);
	const all = [...exact, ...near, ...candidates.filter((c) => c.diff === null).sort(byVotes)].map(
		strip
	);

	const decide = (
		pool: typeof candidates,
		confidence: ResolveConfidence
	): ResolveResult | null => {
		if (pool.length === 0) return null;
		if (pool.length > 1 && pool[0].votes === pool[1].votes) {
			return { match: null, confidence: 'ambiguous', candidates: all };
		}
		return { match: strip(pool[0]), confidence, candidates: all };
	};

	if (query.year) {
		return (
			decide(exact, 'exact') ??
			decide(near, 'near') ?? { match: null, confidence: 'none', candidates: all }
		);
	}
	// Without a year, two titles sharing a name (Dune 1984 and 2021) cannot be
	// told apart, however the votes fall.
	if (candidates.length > 1) return { match: null, confidence: 'ambiguous', candidates: all };
	return decide(candidates, 'title') ?? { match: null, confidence: 'none', candidates: all };
}

/** Resolves a parsed release name; see the module comment. */
export async function resolveTitle(query: ResolveQuery): Promise<ResolveResult> {
	const votes = await gatherCandidateIds(query);
	const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

	// Checked in parallel: each is a full, cached record lookup, and one slow
	// provider answer should not queue the rest behind it.
	const checked = await Promise.all(
		ranked.map(async ([imdbId, count]) => {
			let record = await settle(() => getMetadata(imdbId));
			// An episode's id filed as a show's resolves to its series.
			if (record?.type === 'episode') {
				const seriesId = record.seriesImdbId;
				record = await settle(() => getMetadata(seriesId));
			}
			return record ? { record, votes: count } : null;
		})
	);
	const records = checked.filter((r): r is { record: MetadataRecord; votes: number } => !!r);
	return pickResolution(query, records);
}
