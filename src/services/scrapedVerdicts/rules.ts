/**
 * Deterministic half of the scraped-result verdict: everything about a filename
 * that code can judge reliably. The other half is two narrow questions to
 * TypeSafe's Jev model (see `jev.ts`), and `decide` combines both.
 *
 * Measured on 2026-09-27 against 300 hand-labelled filenames the rules were not
 * tuned on: 98.3% keep/delete agreement, 1% wrong deletions. Handing Jev more
 * context made it worse, not better - with the 2024 Gentlemen TV series in its
 * prompt it deleted 38 genuine 2020 releases of the film - so the judgement
 * that code can make stays in code and Jev only answers what it is good at.
 */

export type Verdict = 'keep' | 'trash';

export const MEDIA_CHOICES = {
	FILM: 'A film or movie release (video file, rip, remux, disc image).',
	TV: 'A TV series, season, episode, show, broadcast or miniseries.',
	GAME_SOFTWARE: 'A video game, repack, mod, app or software.',
	AUDIO: 'Music, soundtrack, album, radio broadcast or audiobook.',
	BOOK_IMAGES: 'Ebook, comic, magazine or image set.',
	ADULT: 'Pornographic content.',
	UNCLEAR: 'Cannot tell from the filename.',
} as const;

export const TITLE_CHOICES = {
	SAME_TITLE:
		"The work's title in the filename is exactly one of the movie's listed titles (ignoring case, punctuation, a leading article, and release tags like year, quality, language, group). Two of the movie's titles joined together (a local title plus the original title), or the title followed by 1 / I / Part 1, also count.",
	DIFFERENT_TITLE:
		"The filename names a different title that contains or resembles one of the movie's titles: extra title words, a subtitle, a number, a plural, or a changed word.",
	NO_TITLE: "None of the movie's listed titles appears in the filename.",
} as const;

export type Media = keyof typeof MEDIA_CHOICES;
export type TitleMatch = keyof typeof TITLE_CHOICES;

export type MovieContext = {
	imdbId: string;
	/** IMDb primary title, used only for display and the trash record. */
	name: string;
	year: number;
	/** Every distinct title IMDb knows the movie by, in any language. */
	titles: string[];
	/**
	 * Folded (trimmed) alternative titles that are also another IMDb work's primary title,
	 * with that work's start years. IMDb lists "Your Lucky Day" as an alternative
	 * title of The Ministry of Ungentlemanly Warfare, and it is also a separate
	 * 2023 film.
	 */
	ambiguous: Record<string, number[]>;
};

const WORD = '[\\p{L}\\p{N}_]';
const START = `(?<!${WORD})`;
const END = `(?!${WORD})`;

const EPISODE = new RegExp(
	[
		`${START}S\\d{1,2}\\s?E\\d{1,3}${END}`,
		`${START}\\d{1,2}x\\d{2,3}${END}`,
		`${START}Cap\\.?\\s?\\d{3}${END}`,
		`${START}E\\d{2,3}${END}`,
		`${START}season${END}`,
		`${START}temporada${END}`,
		`${START}сезон`,
		`${START}series${END}`,
		`${START}episode${END}`,
		'第\\d+[集话話]',
	].join('|'),
	'iu'
);

const PACK = new RegExp(
	[
		'(?<!re)pack\\b',
		'trilog',
		'collection',
		'saga\\b',
		'antholog',
		'hexalog',
		'quadrilog',
		'tetralog',
		'dilog',
		'трилог',
		'антолог',
		'colecci',
		'integral',
		'\\b1[ ,&+-]+2[ ,&+-]+3\\b',
		// Seen trashed in production: a Stallone filmography, 82 best-picture
		// nominees, the MCU phases and "All 4 movies" on their movies' pages.
		'filmograph',
		'фильмограф',
		'\\b\\d+\\s*(?:movies|films)\\b',
		'nominees',
		'\\bphases\\b',
	].join('|'),
	'iu'
);

const ADULT_TAG = /\bxxx\b/i;
/**
 * Four digits that read as a year but are not one: the BT.2020 / Rec.2020 HDR
 * colour space, either side of a resolution (1920x1080, 2048 x 858) and sizes
 * (1900MB). BT.2020 on genuine Civil War HDR releases trashed them in
 * production as a year four off the movie's. A codec after the year ("2014
 * x264") is not a resolution.
 */
const YEAR =
	/(?<!\d)(?<!(?:bt|rec)[ ._-]?)(?<!\d ?x ?)(?:19|20)\d\d(?!\d)(?! ?x ?(?!26[456](?!\d))\d)(?! ?(?:mb|gb|kbps|mbps|fps|hz)\b)/gi;
const YEAR_RANGE = /((?:19|20)\d\d)\s*[-–]\s*((?:19|20)\d\d)/;
const CJK = /[぀-ヿ㐀-鿿가-힯฀-๿]/;
const LEADING_ARTICLE = /^ (the|a|an|le|la|les|el|los|las|il|der|die|das) /;

/**
 * Lower-cases, strips diacritics and punctuation, and pads with spaces so a
 * title can be matched as a whole-word run: " barbarian " is not found inside
 * " barbarians ".
 */
export function fold(value: string): string {
	const text = value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.replace(/&#x27;/g, "'")
		.replace(/&#215;/g, 'x')
		.replace(/&/g, ' and ')
		.replace(/'/g, '');
	const words = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
	return ` ${words.join(' ')} `;
}

export function yearsIn(filename: string): number[] {
	return (filename.match(YEAR) ?? []).map(Number);
}

/** The movie's titles that appear in the filename as whole words. */
export function foundTitles(filename: string, titles: string[]): string[] {
	const haystack = fold(filename);
	const lower = filename.toLowerCase();
	const found: string[] = [];
	for (const title of titles) {
		if (CJK.test(title)) {
			if (title.length >= 2 && lower.includes(title.toLowerCase())) found.push(title);
			continue;
		}
		const needle = fold(title);
		if (needle.trim().length < 3) continue;
		// "Lost & Found" is released as "Lost Found" as often as "Lost and Found".
		const dropped = title.includes('&') ? fold(title.replace(/&/g, ' ')) : null;
		if (haystack.includes(needle) || (dropped && haystack.includes(dropped))) {
			found.push(title);
			continue;
		}
		const bare = needle.replace(LEADING_ARTICLE, ' ');
		if (bare !== needle && bare.trim().length >= 4 && haystack.includes(bare)) {
			found.push(title);
		}
	}
	return found;
}

/**
 * Combines the code rules with Jev's two answers. Order matters: every early
 * return is a rule that code judges better than the model does.
 */
export function decide(
	movie: MovieContext,
	filename: string,
	media: Media,
	titleMatch: TitleMatch
): Verdict {
	const years = yearsIn(filename);
	const nearYear = years.some((y) => Math.abs(y - movie.year) <= 1);
	const found = foundTitles(filename, movie.titles);
	// An adult film's own releases are adult content too: they carry its title
	// and year and the model reads the title as the movie's. Less is not enough,
	// since short aliases ("The Prisoner", "Dude") turn up in unrelated clips.
	const filmLike =
		media === 'FILM' ||
		media === 'UNCLEAR' ||
		(media === 'ADULT' && found.length > 0 && nearYear && titleMatch === 'SAME_TITLE');

	if (ADULT_TAG.test(filename)) return 'trash';

	if (PACK.test(filename) && filmLike) {
		const range = YEAR_RANGE.exec(filename);
		if (range) {
			return Number(range[1]) <= movie.year && movie.year <= Number(range[2])
				? 'keep'
				: 'trash';
		}
		return years.length === 0 || nearYear ? 'keep' : 'trash';
	}

	if (EPISODE.test(filename)) return 'trash';
	// A year one off is normal (release years differ by country); two or more
	// away is a different work.
	if (years.length > 0 && !nearYear) return 'trash';
	if (!filmLike) return 'trash';

	if (
		found.length > 0 &&
		found.every((t) => fold(t).trim() in movie.ambiguous) &&
		years.length > 0
	) {
		const otherYears = found.flatMap((t) => movie.ambiguous[fold(t).trim()]);
		const toOther = Math.min(...years.flatMap((y) => otherYears.map((o) => Math.abs(y - o))));
		const toMovie = Math.min(...years.map((y) => Math.abs(y - movie.year)));
		// A tie trashes: "Daredevil" is an alias of Ong-Bak and also a 2003 film.
		// Same-name video games (Pirates of the Caribbean, Harry Potter, both the
		// films' own years) are left out of `ambiguous` instead.
		if (toOther <= toMovie) return 'trash';
	}
	if (found.length > 0 && nearYear) return 'keep';
	if (found.length === 0 && titleMatch !== 'SAME_TITLE') return 'trash';
	return titleMatch === 'SAME_TITLE' ? 'keep' : 'trash';
}

const MEDIA_KEYS = Object.keys(MEDIA_CHOICES) as Media[];
const TITLE_KEYS = Object.keys(TITLE_CHOICES) as TitleMatch[];

/**
 * The verdict when code alone settles it, whatever Jev would answer; `null`
 * when the answers matter. Saves the model call for episodes, wrong years and
 * tagged adult releases.
 */
export function decideWithoutModel(movie: MovieContext, filename: string): Verdict | null {
	let settled: Verdict | null = null;
	for (const media of MEDIA_KEYS) {
		for (const titleMatch of TITLE_KEYS) {
			const verdict = decide(movie, filename, media, titleMatch);
			if (settled === null) settled = verdict;
			else if (settled !== verdict) return null;
		}
	}
	return settled;
}
