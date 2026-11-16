// An upstream that does not know a show's id can answer a TV search by that id
// as if no id had been sent: every recent post of the season and episode asked
// for, of every show. Asked for Must Date the Playboy! (tt42132738) S01E26 on
// 2026-11-15, one answered with 100 posts of S01E26 of other shows, and a zurg
// took Lets.Go.S01E26 for it, since a client trusts an id search to be about
// the id.
//
// So one upstream's part of an id search is dropped when its posts name six or
// more shows and no word runs through half of them. The posts of one show
// still share a word however they are named: a translated title beside the
// original (Tales from the Crypt, Geschichten aus der Gruft) or fansub groups
// in front of a romanised one. Over 7,370 cached TV searches by id (2026-11-16)
// this dropped 1,687 of the 1,713 answers naming six or more shows from the
// upstream that ignores ids, and no answer from any other.
// Applied at page time, so answers cached before this are served without them too.

/** Where a release name stops naming the show: a season, episode or year. */
const NAME_END =
	/(?:^|[^a-z0-9])(?:s\d{1,3}(?:e\d{1,4})?|\d{1,2}x\d{2,3}|season[^a-z0-9]?\d+|(?:19|20)\d\d)(?:[^a-z0-9]|$)/;

/** Words too common in show names to say two posts are of one show. */
const COMMON = new Set(
	'the and of a an in to de la le les des der die das und us uk on at for with'.split(' ')
);

const MANY_SHOWS = 6;
const SHARED_BY = 0.5;

/** The show a post names, lowercased, or null when its name gives none. */
function showName(title: string): string | null {
	const lower = title.toLowerCase();
	const end = NAME_END.exec(lower);
	if (!end || end.index === 0) return null;
	return (
		lower
			.slice(0, end.index)
			.replace(/[^a-z0-9]+/g, ' ')
			.trim() || null
	);
}

/** Whether one upstream's posts are about many shows rather than the one asked for. */
function aboutManyShows(titles: string[]): boolean {
	const names = titles.map(showName).filter((name): name is string => name !== null);
	if (new Set(names).size < MANY_SHOWS) return false;
	const posts = new Map<string, number>();
	for (const name of names) {
		for (const word of new Set(name.split(' '))) {
			if (word.length > 1 && !COMMON.has(word)) posts.set(word, (posts.get(word) ?? 0) + 1);
		}
	}
	return Math.max(0, ...posts.values()) < names.length * SHARED_BY;
}

/** A TV search's results without the part of any upstream that ignored the id. */
export function withoutIgnoredIds<T extends { id: string; title: string }>(results: T[]): T[] {
	const upstream = (result: T) => result.id.slice(0, Math.max(0, result.id.indexOf(':')));
	const titles = new Map<string, string[]>();
	for (const result of results) {
		const key = upstream(result);
		titles.set(key, [...(titles.get(key) ?? []), result.title]);
	}
	const ignored = new Set(
		[...titles].filter(([, list]) => aboutManyShows(list)).map(([key]) => key)
	);
	return ignored.size === 0
		? results
		: results.filter((result) => !ignored.has(upstream(result)));
}
