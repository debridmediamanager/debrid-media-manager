/**
 * The SQL side of which IMDb titles search offers. Its own module, with only
 * relative imports, because the daily coverage check on the dmm host runs it
 * outside the Next.js app (see scripts/imdb-import/install.sh).
 *
 * Everything here builds SQL when called, never at module load: Prisma's
 * browser stub throws from its helpers, and this module reaches the browser
 * bundle through the search page. A module-level `Prisma.raw` blanked every
 * page on 2026-09-29 (see src/test/infrastructure/prisma-module-load.test.ts).
 */
import { Prisma } from '@prisma/client';
import {
	MOVIE_TITLE_TYPES,
	NON_THEATRICAL_MOVIE_TYPES,
	SHOW_TITLE_TYPES,
} from '../../utils/imdbTitleTypes';

const sqlList = (types: readonly string[]) =>
	Prisma.raw(`(${types.map((t) => `'${t}'`).join(', ')})`);

/**
 * Which titles search offers, as a condition on `imdb_title_basics b` LEFT
 * JOINed to `imdb_title_ratings r`. `scripts/check-search-coverage.ts` checks
 * what users stream against this same condition.
 *
 * Films and series need a ratings row, which drops IMDb's placeholder entries,
 * except in the last two years: an announced or just-released title has no
 * votes yet and is exactly what people search for (Avengers: Doomsday had
 * none on 2026-09-29, and searching it found nothing). Unrated titles rank
 * after every rated one, so they never displace an established match.
 *
 * The other movie-page types (`NON_THEATRICAL_MOVIE_TYPES`) are mostly
 * featurettes, and fulltext relevance rewards a title that repeats the query
 * ("Beyond Batman: ... Batman" outranks Batman Begins), so they need votes:
 * 1000, or 50 in the last two years for specials that have not collected them
 * yet (AEW All In London had 86, and seven users had streamed it, on 2026-09-30). A
 * flat 250 put "From Star Wars to Star Wars" above every Star Wars film; the
 * recent floor moved none of the top results of 42 common searches at 100, 50
 * or 20.
 */
export function searchableTitleSql(mediaType?: 'movie' | 'show'): Prisma.Sql {
	const recent = Prisma.raw(String(new Date().getUTCFullYear() - 1));
	const theatrical =
		mediaType === 'movie'
			? sqlList(['movie'])
			: mediaType === 'show'
				? sqlList(SHOW_TITLE_TYPES)
				: sqlList(['movie', ...SHOW_TITLE_TYPES]);
	const listed = Prisma.sql`(b.title_type IN ${theatrical} AND (r.tconst IS NOT NULL OR b.start_year >= ${recent}))`;
	if (mediaType === 'show') return listed;
	return Prisma.sql`(${listed} OR (b.title_type IN ${sqlList(NON_THEATRICAL_MOVIE_TYPES)} AND (r.num_votes >= 1000 OR (b.start_year >= ${recent} AND r.num_votes >= 50))))`;
}

/** `CASE WHEN b.title_type IN ${movieTypesSql()}` files a result under a movie page. */
export const movieTypesSql = () => sqlList(MOVIE_TITLE_TYPES);
