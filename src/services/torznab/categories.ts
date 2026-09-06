// Newznab category ids for a row of DMM's torrent library.
//
// A stored release is `{hash, title, fileSize}` and nothing else — no category,
// no parsed metadata — so the category has to be derived on the way out. The
// parent comes from the page key the row was read under (`movie:tt…` /
// `tv:tt…:1`), which is authoritative; the subcategory is read off the
// resolution token in the release title, which release names state consistently
// enough to use and not consistently enough to guess at.
//
// A title with no resolution token gets its parent category and nothing else.
// Labelling it SD would be a guess, and a wrong SD label is worse than a missing
// subcategory: a client that mapped only HD and UHD drops the release outright,
// whereas the parent is mapped by default everywhere.

export type LibraryKind = 'movie' | 'tv';

/** Newznab's two parent ids, and the offsets of the subcategories under them. */
const PARENT: Record<LibraryKind, number> = { movie: 2000, tv: 5000 };
const SD = 30;
const HD = 40;
const UHD = 45;

const UHD_TOKEN = /\b(?:2160p|4k|uhd)\b/i;
const HD_TOKEN = /\b(?:1080[pi]|720p)\b/i;
const SD_TOKEN = /\b(?:480p|576p|360p|dvdrip|sdtv)\b/i;

/**
 * Both the parent and, when the title says so, the subcategory. Both are always
 * emitted together — an item carrying only `2040` is invisible to a client that
 * asked for `2000`, which is what Prowlarr's default mapping asks for.
 */
export function categoriesFor(kind: LibraryKind, title: string): number[] {
	const parent = PARENT[kind];
	if (UHD_TOKEN.test(title)) return [parent, parent + UHD];
	if (HD_TOKEN.test(title)) return [parent, parent + HD];
	if (SD_TOKEN.test(title)) return [parent, parent + SD];
	return [parent];
}

/** `cat=` as a client sends it: a comma-separated id list, junk entries dropped. */
export function parseCategoryFilter(raw: string): number[] {
	return raw
		.split(',')
		.map((part) => Number.parseInt(part.trim(), 10))
		.filter((id) => Number.isInteger(id) && id > 0);
}

/**
 * Whether an item satisfies a client's `cat=` filter.
 *
 * A parent id (x000) matches anything beneath it, which is what a client asking
 * for `2000` means and what every real indexer does. An absent filter matches
 * everything: no `cat=` is "no opinion", not "nothing".
 */
export function matchesCategoryFilter(itemCategories: number[], requested: number[]): boolean {
	if (requested.length === 0) return true;
	return requested.some((wanted) =>
		wanted % 1000 === 0
			? itemCategories.some((id) => id >= wanted && id < wanted + 1000)
			: itemCategories.includes(wanted)
	);
}
