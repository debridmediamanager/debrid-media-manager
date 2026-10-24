import { Prisma } from '@prisma/client';
import { DatabaseClient } from './client';
import { movieTypesSql, searchableTitleSql } from './searchableTitles';

export type ImdbSearchResult = {
	imdbId: string;
	type: 'movie' | 'show';
	year: number | null;
	title: string;
	originalTitle: string | null;
	rating: number | null;
	votes: number | null;
	isOriginalMatch: boolean;
};

export class ImdbSearchService extends DatabaseClient {
	/**
	 * Search IMDB titles using fulltext search on title variants
	 * Falls back to LIKE search if fulltext returns no results
	 */
	async searchTitles(
		keyword: string,
		options: {
			limit?: number;
			year?: number;
			mediaType?: 'movie' | 'show';
		} = {}
	): Promise<ImdbSearchResult[]> {
		const { limit = 50, year, mediaType } = options;

		// Clean the keyword for search
		const cleanKeyword = keyword
			.replace(/[^\w\s]/gi, ' ')
			.split(' ')
			.filter((w) => w.length > 0)
			.join(' ')
			.trim();

		if (!cleanKeyword) {
			return [];
		}

		const typeFilter = Prisma.sql`AND ${searchableTitleSql(mediaType)}`;

		// Build year filter as parameterized Prisma.sql
		const yearFilter = year ? Prisma.sql`AND b.start_year = ${year}` : Prisma.empty;

		const exact = ImdbSearchService.fulltextCannotFind(cleanKeyword)
			? await this.searchExactTitles(cleanKeyword, typeFilter, yearFilter, limit)
			: [];
		const withExact = (results: ImdbSearchResult[]) => {
			const seen = new Set(exact.map((r) => r.imdbId));
			return [...exact, ...results.filter((r) => !seen.has(r.imdbId))].slice(0, limit);
		};

		// Try fulltext search on imdb_title_basics first (faster, smaller table)
		try {
			const results = await this.searchBasicsFulltext(
				cleanKeyword,
				typeFilter,
				yearFilter,
				limit
			);
			if (results.length > 0) {
				return withExact(results);
			}
		} catch (error) {
			// Fulltext index might not exist yet
			console.warn('Basics fulltext search failed:', error);
		}

		// Try fulltext search on imdb_title_akas (includes foreign titles)
		try {
			const results = await this.searchWithFulltext(
				cleanKeyword,
				typeFilter,
				yearFilter,
				limit
			);
			if (results.length > 0) {
				return withExact(results);
			}
		} catch (error) {
			// Fulltext index might not exist yet
			console.warn('Akas fulltext search failed:', error);
		}

		if (exact.length > 0) {
			return exact;
		}

		// Fall back to LIKE search on basics table
		return this.searchWithLike(cleanKeyword, typeFilter, yearFilter, limit);
	}

	/**
	 * True when no word of the keyword is in the fulltext index: all shorter
	 * than innodb_ft_min_token_size (3 on dmmdb) or stopwords. "20/20", "Up",
	 * "It", "Us", "24", "9-1-1" and "M*A*S*H" could never be found, and the
	 * prefix match "+20*" filled the results with 2012 and 2046 (2026-10-24).
	 */
	static fulltextCannotFind(keyword: string): boolean {
		return !keyword
			.split(' ')
			.some(
				(w) => w.length >= 3 && !ImdbSearchService.FULLTEXT_STOPWORDS.has(w.toLowerCase())
			);
	}

	/**
	 * The titles the keyword could have been before its punctuation was
	 * stripped: "20 20" was "20/20", "9 1 1" was "9-1-1", "m a s h" "M*A*S*H".
	 */
	static exactTitleSpellings(keyword: string): string[] {
		const words = keyword.split(' ');
		return [...new Set(['', ' ', '/', '-', ':', '.', '*', ' & '].map((s) => words.join(s)))];
	}

	/** Equality on primary_title, served by idx_primary_title: a scan would take ~28 s. */
	private async searchExactTitles(
		keyword: string,
		typeFilter: Prisma.Sql,
		yearFilter: Prisma.Sql,
		limit: number
	): Promise<ImdbSearchResult[]> {
		const query = Prisma.sql`
			SELECT
				b.tconst as imdbId,
				CASE
					WHEN b.title_type IN ${movieTypesSql()} THEN 'movie'
					ELSE 'show'
				END as type,
				b.start_year as year,
				b.primary_title as title,
				b.original_title as originalTitle,
				r.average_rating as rating,
				r.num_votes as votes,
				1 as isOriginalMatch
			FROM imdb_title_basics b
			LEFT JOIN imdb_title_ratings r ON b.tconst = r.tconst
			WHERE b.primary_title IN (${Prisma.join(ImdbSearchService.exactTitleSpellings(keyword))})
				${typeFilter}
				${yearFilter}
				AND b.is_adult = 0
			ORDER BY r.tconst IS NULL, COALESCE(r.num_votes, 0) DESC, b.start_year DESC
			LIMIT ${limit}
		`;

		const results = await this.prisma.$queryRaw<any[]>(query);

		return results.map((r) => ({
			imdbId: r.imdbId,
			type: r.type as 'movie' | 'show',
			year: r.year,
			title: r.title || r.originalTitle || '',
			originalTitle: r.originalTitle,
			rating: r.rating ? Number(r.rating) : null,
			votes: r.votes ? Number(r.votes) : null,
			isOriginalMatch: Boolean(r.isOriginalMatch),
		}));
	}

	// MySQL InnoDB default stopwords - these break search when using + (required) prefix
	private static readonly FULLTEXT_STOPWORDS = new Set([
		'a',
		'about',
		'an',
		'are',
		'as',
		'at',
		'be',
		'by',
		'com',
		'de',
		'en',
		'for',
		'from',
		'how',
		'i',
		'in',
		'is',
		'it',
		'la',
		'of',
		'on',
		'or',
		'that',
		'the',
		'this',
		'to',
		'was',
		'what',
		'when',
		'where',
		'who',
		'will',
		'with',
		'und',
		'www',
	]);

	/**
	 * The keyword in fulltext boolean mode, null when it has no word to require.
	 * Stopwords are optional (no +), other words required (+). So is a word
	 * shorter than innodb_ft_min_token_size (3 on dmmdb), which no index holds:
	 * required, "10 Things I Hate About You" matched nothing and fell through to
	 * the LIKE scan, 47 s (2026-10-19). A query of nothing but short words keeps
	 * them required, as before.
	 */
	static fulltextKeyword(keyword: string): string | null {
		const words = keyword
			.split(' ')
			.map((w) => w.replace(/[+\-<>()~*'"@]/g, ''))
			.filter((w) => w.length >= 2);
		const indexed = (w: string) =>
			w.length >= 3 && !ImdbSearchService.FULLTEXT_STOPWORDS.has(w.toLowerCase());
		const anyIndexed = words.some(indexed);
		const required = (w: string) =>
			anyIndexed ? indexed(w) : !ImdbSearchService.FULLTEXT_STOPWORDS.has(w.toLowerCase());
		if (!words.some(required)) {
			return null;
		}
		return words.map((w) => (required(w) ? `+${w}*` : `${w}*`)).join(' ');
	}

	private async searchBasicsFulltext(
		keyword: string,
		typeFilter: Prisma.Sql,
		yearFilter: Prisma.Sql,
		limit: number
	): Promise<ImdbSearchResult[]> {
		const fulltextKeyword = ImdbSearchService.fulltextKeyword(keyword);
		// If all words are stopwords, skip fulltext (it won't be effective)
		if (!fulltextKeyword) {
			return [];
		}

		const query = Prisma.sql`
			SELECT
				b.tconst as imdbId,
				CASE
					WHEN b.title_type IN ${movieTypesSql()} THEN 'movie'
					ELSE 'show'
				END as type,
				b.start_year as year,
				b.primary_title as title,
				b.original_title as originalTitle,
				r.average_rating as rating,
				r.num_votes as votes,
				1 as isOriginalMatch,
				MATCH(b.primary_title) AGAINST(${fulltextKeyword} IN BOOLEAN MODE) as relevance
			FROM imdb_title_basics b
			LEFT JOIN imdb_title_ratings r ON b.tconst = r.tconst
			WHERE MATCH(b.primary_title) AGAINST(${fulltextKeyword} IN BOOLEAN MODE)
				${typeFilter}
				${yearFilter}
				AND b.is_adult = 0
			ORDER BY r.tconst IS NULL, relevance DESC, COALESCE(r.num_votes, 0) DESC, b.start_year DESC
			LIMIT ${limit}
		`;

		const results = await this.prisma.$queryRaw<any[]>(query);

		return results.map((r) => ({
			imdbId: r.imdbId,
			type: r.type as 'movie' | 'show',
			year: r.year,
			title: r.title || r.originalTitle || '',
			originalTitle: r.originalTitle,
			rating: r.rating ? Number(r.rating) : null,
			votes: r.votes ? Number(r.votes) : null,
			isOriginalMatch: Boolean(r.isOriginalMatch),
		}));
	}

	private async searchWithFulltext(
		keyword: string,
		typeFilter: Prisma.Sql,
		yearFilter: Prisma.Sql,
		limit: number
	): Promise<ImdbSearchResult[]> {
		const fulltextKeyword = ImdbSearchService.fulltextKeyword(keyword);
		// If all words are stopwords, skip fulltext (it won't be effective)
		if (!fulltextKeyword) {
			return [];
		}

		// Use Prisma.raw for fulltext keyword since MATCH AGAINST needs literal string
		const query = Prisma.sql`
			SELECT
				b.tconst as imdbId,
				CASE
					WHEN b.title_type IN ${movieTypesSql()} THEN 'movie'
					ELSE 'show'
				END as type,
				b.start_year as year,
				b.primary_title as title,
				b.original_title as originalTitle,
				r.average_rating as rating,
				r.num_votes as votes,
				MAX(a.is_original_title) as isOriginalMatch,
				MAX(MATCH(a.title) AGAINST(${fulltextKeyword} IN BOOLEAN MODE)) as relevance
			FROM imdb_title_akas a
			JOIN imdb_title_basics b ON a.title_id = b.tconst
			LEFT JOIN imdb_title_ratings r ON b.tconst = r.tconst
			WHERE MATCH(a.title) AGAINST(${fulltextKeyword} IN BOOLEAN MODE)
				${typeFilter}
				${yearFilter}
				AND b.is_adult = 0
			GROUP BY b.tconst, b.title_type, b.start_year, b.primary_title, b.original_title, r.average_rating, r.num_votes
			ORDER BY r.tconst IS NULL, relevance DESC, COALESCE(r.num_votes, 0) DESC, b.start_year DESC
			LIMIT ${limit}
		`;

		const results = await this.prisma.$queryRaw<any[]>(query);

		return results.map((r) => ({
			imdbId: r.imdbId,
			type: r.type as 'movie' | 'show',
			year: r.year,
			title: r.title || r.originalTitle || '',
			originalTitle: r.originalTitle,
			rating: r.rating ? Number(r.rating) : null,
			votes: r.votes ? Number(r.votes) : null,
			isOriginalMatch: Boolean(r.isOriginalMatch),
		}));
	}

	/**
	 * The LIKE fallback reads every title (no index serves LOWER(...) LIKE '%…%'),
	 * 22-30 s for a movie search on dmmdb's 12.9M (2026-10-19). Past this it gives
	 * up: what the fulltext searches did not find is almost always no title.
	 */
	static readonly LIKE_TIMEOUT_MS = 5000;

	private async searchWithLike(
		keyword: string,
		typeFilter: Prisma.Sql,
		yearFilter: Prisma.Sql,
		limit: number
	): Promise<ImdbSearchResult[]> {
		// Use imdb_title_basics for faster search (smaller table, ~11M rows vs 54M in akas)
		const likePattern = `%${keyword}%`;
		const startsWithPattern = `${keyword}%`;

		const query = Prisma.sql`
			SELECT /*+ MAX_EXECUTION_TIME(${Prisma.raw(String(ImdbSearchService.LIKE_TIMEOUT_MS))}) */
				b.tconst as imdbId,
				CASE
					WHEN b.title_type IN ${movieTypesSql()} THEN 'movie'
					ELSE 'show'
				END as type,
				b.start_year as year,
				b.primary_title as title,
				b.original_title as originalTitle,
				r.average_rating as rating,
				r.num_votes as votes,
				1 as isOriginalMatch,
				CASE
					WHEN LOWER(b.primary_title) = LOWER(${keyword}) THEN 3
					WHEN LOWER(b.primary_title) LIKE LOWER(${startsWithPattern}) THEN 2
					ELSE 1
				END as matchQuality
			FROM imdb_title_basics b
			LEFT JOIN imdb_title_ratings r ON b.tconst = r.tconst
			WHERE (LOWER(b.primary_title) LIKE LOWER(${likePattern})
				OR LOWER(b.original_title) LIKE LOWER(${likePattern}))
				${typeFilter}
				${yearFilter}
				AND b.is_adult = 0
			ORDER BY r.tconst IS NULL, matchQuality DESC, COALESCE(r.num_votes, 0) DESC, b.start_year DESC
			LIMIT ${limit}
		`;

		let results: any[];
		try {
			results = await this.prisma.$queryRaw<any[]>(query);
		} catch (error) {
			// ER_QUERY_TIMEOUT (3024): the scan ran out of time, which is no match.
			if (String((error as Error)?.message).includes('maximum statement execution time')) {
				return [];
			}
			throw error;
		}

		return results.map((r) => ({
			imdbId: r.imdbId,
			type: r.type as 'movie' | 'show',
			year: r.year,
			title: r.title || r.originalTitle || '',
			originalTitle: r.originalTitle,
			rating: r.rating ? Number(r.rating) : null,
			votes: r.votes ? Number(r.votes) : null,
			isOriginalMatch: Boolean(r.isOriginalMatch),
		}));
	}

	/**
	 * The raw IMDb `title_type` for an id — `movie`, `tvSeries`, `tvMovie`, …
	 *
	 * `getTitleById` collapses everything that is not exactly `movie` into
	 * `'show'`, which is right for a search result and wrong for deciding where a
	 * completed transfer gets filed: a `tvMovie` or a `video` lives on a
	 * `/movie/tt…` page in DMM and has no season to file under. Callers that need
	 * to tell those apart read the type itself.
	 */
	async getTitleType(imdbId: string): Promise<string | null> {
		const result = await this.prisma.imdbTitleBasics.findUnique({
			where: { tconst: imdbId },
			select: { titleType: true },
		});
		return result?.titleType ?? null;
	}

	/**
	 * Get title details by IMDB ID
	 */
	async getTitleById(imdbId: string): Promise<ImdbSearchResult | null> {
		const result = await this.prisma.imdbTitleBasics.findUnique({
			where: { tconst: imdbId },
		});

		if (!result) return null;

		const rating = await this.prisma.imdbTitleRatings.findUnique({
			where: { tconst: imdbId },
		});

		return {
			imdbId: result.tconst,
			type: result.titleType === 'movie' ? 'movie' : 'show',
			year: result.startYear,
			title: result.primaryTitle || result.originalTitle || '',
			originalTitle: result.originalTitle,
			rating: rating?.averageRating ? Number(rating.averageRating) : null,
			votes: rating?.numVotes ?? null,
			isOriginalMatch: true,
		};
	}
}
