/**
 * AniDB's daily titles dump, the list of every anime AniDB knows about.
 *
 * It is the only source that names *every* AniDB entry: the Fribb and
 * Anime-Lists mappings both lag it by days or weeks, and neither carries an
 * entry's titles in every language. It carries nothing but titles, though, so
 * an entry's poster, synopsis and rating come from Kitsu instead.
 *
 * AniDB bans clients that fetch the dump more than once a day, and serves plain
 * http a Cloudflare 403, so the importer downloads it over https at most once a
 * day and otherwise reads its cached copy (see `shouldDownloadAnidbDump`).
 */

export const ANIDB_TITLES_URL = 'https://anidb.net/api/anime-titles.dat.gz';

/** The dump's own numbering: `1=primary title (one per anime)`, and so on. */
export type AnidbTitleType = 'primary' | 'synonym' | 'short' | 'official';

const TITLE_TYPES: Record<string, AnidbTitleType> = {
	'1': 'primary',
	'2': 'synonym',
	'3': 'short',
	'4': 'official',
};

export interface AnidbTitle {
	type: AnidbTitleType;
	lang: string;
	title: string;
}

export interface AnidbEntry {
	aid: number;
	/** The romanised main title; AniDB publishes exactly one per entry. */
	primary: string;
	titles: AnidbTitle[];
}

/**
 * Parse the uncompressed `anime-titles.dat`.
 *
 * Each line is `<aid>|<type>|<language>|<title>`; lines starting with `#` are
 * comments. A title may itself contain `|`, so only the first three are split.
 */
export function parseAnidbTitles(text: string): Map<number, AnidbEntry> {
	const entries = new Map<number, AnidbEntry>();
	for (const rawLine of text.split('\n')) {
		const line = rawLine.replace(/\r$/, '');
		if (line === '' || line.startsWith('#')) continue;

		const first = line.indexOf('|');
		const second = line.indexOf('|', first + 1);
		const third = line.indexOf('|', second + 1);
		if (first < 0 || second < 0 || third < 0) continue;

		const aid = Number(line.slice(0, first));
		const type = TITLE_TYPES[line.slice(first + 1, second)];
		const lang = line.slice(second + 1, third);
		const title = line.slice(third + 1).trim();
		if (!Number.isSafeInteger(aid) || aid <= 0 || !type || title === '') continue;

		let entry = entries.get(aid);
		if (!entry) {
			entry = { aid, primary: '', titles: [] };
			entries.set(aid, entry);
		}
		entry.titles.push({ type, lang, title });
		if (type === 'primary') entry.primary = title;
	}

	// An entry without its primary title still has a name; fall back to the
	// first official one rather than dropping an entry AniDB lists.
	for (const entry of entries.values()) {
		if (entry.primary === '') {
			entry.primary =
				entry.titles.find((t) => t.type === 'official' && t.lang === 'en')?.title ??
				entry.titles[0].title;
		}
	}
	return entries;
}

/** Official titles in these languages lead the alias list, in this order. */
const PREFERRED_LANGS = ['en', 'x-jat', 'ja'];
const MAX_ALIASES = 30;

/**
 * The names an entry goes by, primary title first, the way existing rows list
 * them: the primary, then the preferred-language official titles, then every
 * other official title, synonym and short title AniDB carries, deduplicated.
 */
export function aliasesFor(entry: AnidbEntry): string[] {
	const rank = (t: AnidbTitle): number => {
		if (t.type === 'primary') return 0;
		if (t.type === 'official') {
			const at = PREFERRED_LANGS.indexOf(t.lang);
			return at >= 0 ? 1 + at : 1 + PREFERRED_LANGS.length;
		}
		return t.type === 'synonym' ? 10 : 11;
	};
	const ordered = entry.titles
		.map((t, index) => ({ t, index }))
		.sort((a, b) => rank(a.t) - rank(b.t) || a.index - b.index);

	const seen = new Set<string>();
	const aliases: string[] = [];
	for (const { t } of ordered) {
		if (seen.has(t.title)) continue;
		seen.add(t.title);
		aliases.push(t.title);
		if (aliases.length >= MAX_ALIASES) break;
	}
	return aliases;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * The shortest gap allowed between two downloads, however the days fall. A
 * cron that fires at the same minute every day then downloads every day, and a
 * manual re-run the same day, or just after midnight UTC, reads the cache.
 */
const MIN_DOWNLOAD_GAP_MS = 20 * 60 * 60 * 1000;

/**
 * Whether the dump may be requested now.
 *
 * AniDB's rule is once a day. It counts *requests*, not successful downloads,
 * so the caller records the attempt before it is made and a failed download
 * still uses up the day. The rule here is one attempt per UTC calendar day,
 * and never two within 20 hours.
 */
export function shouldDownloadAnidbDump(lastAttemptMs: number | null, nowMs: number): boolean {
	if (lastAttemptMs === null) return true;
	if (nowMs - lastAttemptMs < MIN_DOWNLOAD_GAP_MS) return false;
	return Math.floor(lastAttemptMs / DAY_MS) !== Math.floor(nowMs / DAY_MS);
}
