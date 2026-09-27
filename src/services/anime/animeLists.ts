/**
 * The Anime-Lists project's `anime-list-master.xml`, one `<anime>` per AniDB id.
 *
 * Its TVDB, TMDB and IMDb ids are already folded into the Fribb dataset (every
 * IMDb id it carried on 2026-09-27 was in Fribb too), so it is read here for
 * what Fribb lacks: an entry for every AniDB id, updated daily, whose `tvdbid`
 * attribute says what an entry *is* when it has no TVDB series - `movie`,
 * `OVA`, `web` or `hentai`. `hentai` is AniDB's adult flag carried over, and the
 * only one available for an entry Kitsu has no id for: 1,274 of the 3,527 AniDB
 * ids missing from the `Anime` table on 2026-09-27 carried it, against 15 of
 * the 13,483 already in the table, which was built without adult titles.
 */

export const ANIME_LISTS_URL =
	'https://raw.githubusercontent.com/Anime-Lists/anime-lists/master/anime-list-master.xml';

export interface AnimeListsEntry {
	aid: number;
	/** A TVDB series id, or the kind of entry that has none (`movie`, `hentai`...). */
	tvdbid: string;
	/** TVDB season the entry maps to; 0 is specials. Null when unmapped. */
	defaultTvdbSeason: number | null;
	imdbIds: string[];
	name: string;
}

const XML_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
};

export function decodeXmlEntities(value: string): string {
	return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
		if (body[0] === '#') {
			const code =
				body[1] === 'x' || body[1] === 'X'
					? parseInt(body.slice(2), 16)
					: parseInt(body.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
		}
		return XML_ENTITIES[body.toLowerCase()] ?? whole;
	});
}

const ANIME_ELEMENT = /<anime\s([^>]*?)\/?>([\s\S]*?)(?=<anime\s|<\/anime-list>)/g;
const ATTRIBUTE = /([\w-]+)="([^"]*)"/g;
const NAME = /<name>([\s\S]*?)<\/name>/;

/**
 * The file is a flat list of one element type with double-quoted attributes,
 * so it is read with patterns rather than a parser the repository does not
 * otherwise need. An `<anime>` without a numeric `anidbid` is skipped.
 */
export function parseAnimeLists(xml: string): Map<number, AnimeListsEntry> {
	const entries = new Map<number, AnimeListsEntry>();
	for (const match of xml.matchAll(ANIME_ELEMENT)) {
		const attrs: Record<string, string> = {};
		for (const [, key, value] of match[1].matchAll(ATTRIBUTE)) {
			attrs[key] = decodeXmlEntities(value);
		}
		const aid = Number(attrs.anidbid);
		if (!Number.isSafeInteger(aid) || aid <= 0) continue;

		const season = attrs.defaulttvdbseason;
		const name = NAME.exec(match[2]);
		entries.set(aid, {
			aid,
			tvdbid: (attrs.tvdbid ?? '').trim(),
			defaultTvdbSeason: season && /^\d+$/.test(season) ? Number(season) : null,
			imdbIds: (attrs.imdbid ?? '')
				.split(',')
				.map((id) => id.trim())
				.filter((id) => /^tt\d+$/.test(id)),
			name: name ? decodeXmlEntities(name[1].trim()) : '',
		});
	}
	return entries;
}

/** AniDB's 18+ flag, as Anime-Lists carries it. */
export function isAdultEntry(entry: AnimeListsEntry | undefined): boolean {
	return entry?.tvdbid.toLowerCase() === 'hentai';
}

/**
 * The `Anime.type` an entry's `tvdbid` implies when nothing better is known.
 * A numeric id is a TV series, but so is a sequel filed under its first season's
 * series, so it says nothing about TV versus OVA and is not used.
 */
export function typeFromAnimeLists(entry: AnimeListsEntry | undefined): string | null {
	switch (entry?.tvdbid.toLowerCase()) {
		case 'movie':
			return 'MOVIE';
		case 'ova':
			return 'OVA';
		case 'web':
			return 'ONA';
		case 'tv special':
		case 'music video':
			return 'SPECIAL';
		default:
			return null;
	}
}
