import type { LibraryIdentification } from '@/utils/libraryIdentify';
import { normalize } from '@/utils/mediaId';

interface Row {
	hash: string;
	/** The parsed title: "Title (Year)" for a movie, "Show ➡️ S01" for a show. */
	title: string;
	mediaType: 'movie' | 'tv';
	info?: { title?: string };
}

export interface HashlistGrouping {
	/** Each row's title by hash: an IMDb id, or its parsed title when nothing names it. */
	keyOf: ReadonlyMap<string, string>;
	/** Movie or show by hash, the identifier's word over the filename's. */
	kindOf: ReadonlyMap<string, 'movie' | 'tv'>;
	/** Rows per title key. */
	counts: ReadonlyMap<string, number>;
	movieCount: number;
	tvCount: number;
}

/** A row's parsed title; a show's episodes and seasons share its name alone. */
const parsedTitle = (row: Row) => (row.mediaType === 'tv' && row.info?.title) || row.title;
/** Parsed titles that differ only in case or punctuation are one title. */
const parsedKey = (row: Row) => `${row.mediaType}:${normalize(parsedTitle(row))}`;

/**
 * Groups a hashlist's rows by title. Named rows group by IMDb id, which joins
 * spellings the parser keeps apart ("Isekai Ojisan", "Uncle from Another World").
 * An unnamed row takes the id of the named rows sharing its parsed title only when
 * they all agree, as the library page does, so it never joins the wrong title.
 */
export function groupHashlist(
	rows: readonly Row[],
	identified: Readonly<Record<string, LibraryIdentification>>
): HashlistGrouping {
	const bridge = new Map<string, LibraryIdentification | null>();
	for (const row of rows) {
		const found = identified[row.hash];
		if (!found) continue;
		const key = parsedKey(row);
		const seen = bridge.get(key);
		bridge.set(key, seen === undefined || seen?.imdbId === found.imdbId ? found : null);
	}

	const keyOf = new Map<string, string>();
	const kindOf = new Map<string, 'movie' | 'tv'>();
	const counts = new Map<string, number>();
	const movies = new Set<string>();
	const shows = new Set<string>();
	for (const row of rows) {
		const found = identified[row.hash] ?? bridge.get(parsedKey(row)) ?? undefined;
		const key = found?.imdbId ?? parsedTitle(row);
		const kind = found?.kind ?? row.mediaType;
		keyOf.set(row.hash, key);
		kindOf.set(row.hash, kind);
		counts.set(key, (counts.get(key) ?? 0) + 1);
		(kind === 'tv' ? shows : movies).add(key);
	}
	return { keyOf, kindOf, counts, movieCount: movies.size, tvCount: shows.size };
}
