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
		'antolog',
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
		// A count, not a year: "2017 Movies" is an uploader tag.
		'\\b(?!(?:19|20)\\d\\d\\b)\\d+\\s*(?:movies|films)\\b',
		'nominees',
		'\\bphases\\b',
		// The Polish for a collection, not for a collector ("Kolekcjoner kości",
		// the Bone Collector) or a collector's edition ("kolekcjonerskie"), and
		// "All Movies" spaced: "[All.Films][RG]" is a release group.
		'kolekcj[aei]\\b',
		'\\ball (?:the )?(?:films|movies)\\b',
	].join('|'),
	'iu'
);

/**
 * Words for a set of one series' films. Unlike the words above they name the
 * series, so they count only when the model read a title of the movie in the
 * name: Brat's and Khmel's "Дилогия" sat on Men in Black, Jackie Brown and Boyz
 * n the Hood, and the model saw no title of those films in any of them.
 */
const SERIES_PACK = new RegExp(
	[
		'duolog',
		'дилог',
		'pentalog',
		'pentolog',
		'пенталог',
		'quadrolog',
		'квадролог',
		'tetrolog',
		'тетралог',
		'heptalog',
		'octalog',
		'(?:double|triple)[ ._-]*feature',
	].join('|'),
	'iu'
);

/**
 * Whether the filename carries one of `words` that is not a word of the
 * movie's own titles. "Saga" in "Horizon: An American Saga - Chapter 1" names
 * the series, not a set: that release on the Chapter 2 page is the other film.
 */
function packWordIn(filename: string, words: RegExp, titles: string[]): boolean {
	const all = new RegExp(words.source, `${words.flags}g`);
	const own = titles.map(fold).join('|');
	for (const match of filename.matchAll(all)) {
		// The whole word the match sits in: "Collection" is not inside the
		// title Le Collectionneur.
		const rest = filename.slice(match.index + match[0].length).match(/^[\p{L}\p{N}]*/u)![0];
		if (!own.includes(fold(match[0] + rest))) return true;
	}
	return false;
}

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

function normalized(value: string): string {
	return value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.replace(/&#x27;/g, "'")
		.replace(/&#215;/g, 'x')
		.replace(/\s*&\s*/g, ' and ')
		.replace(/'/g, '');
}

/**
 * Lower-cases, strips diacritics and punctuation, and pads with spaces so a
 * title can be matched as a whole-word run: " barbarian " is not found inside
 * " barbarians ".
 */
export function fold(value: string): string {
	const words = normalized(value)
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
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
 * Where one title ends and the next begins in a release name: "Local / Original",
 * "[Group] Title", "Site - Title", "Title (Original)", "死侍。Tagline", and a run
 * of spaces where a separator was stripped. A dash counts only with spaces round
 * it, so "x264-GROUP" and "Spider-Man" do not. A colon does not count: after
 * "Pán prstenů:" comes the subtitle Válka Rohirů, not a title of its own.
 */
const STARTS_TITLE = /[/|\\([\]{}【】「」『』《》+。]|\s[-–—]+\s/u;
/** As above, plus what can only end a title: "Title) " and "Title, ". */
const ENDS_TITLE = /[/|\\()[\]{},【】「」『』《》+。]|\s[-–—]+\s/u;
const YEAR_WORD = /^(?:19|20)\d\d$/;
/**
 * Quality, source and codec tags. Once one follows the year, the rest is never
 * the title: "John Carter (2012) 720p HDDRiP AC3 - SiNiSTER" ends with a group.
 * Before the year they are a prefix ("[1080p] Atlas (2024)").
 */
const TECH_TAG =
	/^(?:\d{3,4}[pi]|[48]k|uhd|hdr\d*|bluray|bdrip|brrip|bdremux|remux|webrip|webdl|hdrip|dvdrip|dvdscr|hdtv|hdcam|camrip|x26[456]|h26[456]|hevc|avc|av1|xvid|divx|aac\d*|ac3|dts|ddp\d*|eac3|truehd|atmos)$/;
/** Words a release appends to its title: the tags above plus edition, language and container. */
const RELEASE_TAG =
	/^(?:hd|fhd|sd|dv|sdr|10bit|8bit|blu|bd|web|dl|dvd\d?|scr|screener|cam|ts|tc|r5|dd\d*|mp3|flac|opus|mkv|mp4|avi|iso|multi|dual|dub|dubbed|sub|subs|subbed|extended|unrated|uncut|remastered|restored|proper|repack|limited|internal|imax|3d|ita|eng|english|spanish|castellano|latino|french|truefrench|vff|vostfr|german|hindi|rus|ukr|pl|cz)$/;

function scriptOf(word: string): string | null {
	const letter = word.match(/\p{L}/u)?.[0];
	if (!letter) return null;
	if (/\p{Script=Latin}/u.test(letter)) return 'Latin';
	if (/\p{Script=Cyrillic}/u.test(letter)) return 'Cyrillic';
	if (/\p{Script=Greek}/u.test(letter)) return 'Greek';
	if (CJK.test(letter)) return 'CJK';
	return 'other';
}

type Word = {
	text: string;
	/** A title can begin at this word. */
	starts: boolean;
	/** A title running up to this word has ended before it. */
	ends: boolean;
};

/** The filename as `fold` words, each marked with where titles can begin and end. */
function releaseWords(filename: string): Word[] {
	const text = normalized(filename);
	const words: Word[] = [];
	let last = 0;
	let tagged = false;
	let dated = false;
	// The script of the last word that had letters: "Iron Man 2 มหาประลัย"
	// changes script after the 2.
	let prevScript: string | null = null;
	for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
		const word = match[0];
		const gap = text.slice(last, match.index);
		const spaced = gap.replace(/[._]/g, ' ');
		const prev = words.at(-1)?.text;
		const script = scriptOf(word);
		const newScript = !!script && !!prevScript && script !== prevScript;
		prevScript = script ?? prevScript;
		const tag = TECH_TAG.test(word);
		words.push({
			text: word,
			starts:
				!tagged &&
				(!prev ||
					STARTS_TITLE.test(spaced) ||
					/\s\s/.test(gap) ||
					newScript ||
					YEAR_WORD.test(prev) ||
					prev === 'aka'),
			ends:
				ENDS_TITLE.test(spaced) ||
				/\s\s/.test(gap) ||
				newScript ||
				YEAR_WORD.test(word) ||
				tag ||
				RELEASE_TAG.test(word) ||
				word === 'aka',
		});
		tagged ||= tag && dated;
		dated ||= YEAR_WORD.test(word);
		last = match.index + word.length;
	}
	return words;
}

/**
 * A number that tells one film of a series from another: 1 to 99, or I to XX.
 * Never 0: "v1 0" is a version.
 */
const NUMBER = /^(?:0?[1-9]\d?|i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xvi{0,3}|xix|xx)$/;
/** The first film's number, which it is often released under: "Rocky 1", "Saw I". */
const FIRST = /^(?:0?1|i|one)$/;
/**
 * Words that put a number on a film of a series, or on a set of them: "Vol 1",
 * "Parts I & II", "1 and 2 Films".
 */
const INSTALMENT =
	/^(?:parts?|pt|vols?|volumes?|chapters?|capitulo|parte|partie|teil|czesc|часть|фильм|films?|movies?|filmu)$/u;
/**
 * Words that make what follows a title an edition of the film rather than
 * another title: "Skynet Edition", "Coppola Restoration", "Directors Cut",
 * "Colorized Version", "Red Menace Reconstruction", "Расширенная версия".
 */
const EDITION_NOUN =
	/^(?:edition|editon|edicion|edizione|edicao|cut|version|versao|versione|версия|издание|restoration|reconstruction|remaster|redux|edit|recut|workprint)$/u;
/**
 * Other words an edition or a release adds after a title without making it a
 * different one: "The Ultimate Cut", "40th Ann Ed Ext", "Versao Estendida",
 * "в 3Д", "Live Action", a revision ("V2"), and the genres and languages a
 * release writes before its year ("Election Comedy Romance (1999)").
 */
const EDITION_WORD =
	/^(?:extended|ext|directors?|diretor|dc|final|theatrical|special|ultimate|definitive|collectors?|criterion|anniversary|ann|ed|uncut|unrated|uncensored|remastered|restored|colou?rized|open|matte|imax|3d|3д|estendida|extendida|estesa|integrale|langfassung|kinofassung|hybrid|fan|live|action|v\d+|расширенная|режиссерская|театральная|comedy|romance|romantic|drama|horror|thriller|adventure|animation|animated|fantasy|documentary|musical|western|crime|mystery|\d+(?:st|nd|rd|th)|nordic|dublado|legendado|audio|tamil|telugu|malayalam|kannada|bengali|korean|japanese|chinese|italian|polish|lektor|napisy|dabing|swedish|danish|norwegian|finnish|dutch|portuguese|brazilian|russian|turkish|arabic|thai)$/u;
/** Words that join title words without being one: "of", "and", "de", "и". */
const LINKING =
	/^(?:the|a|an|of|and|amp|in|on|em|en|y|e|et|und|i|de|da|do|du|des|del|la|le|les|el|il|lo|der|die|das|в|во|и|на|z|w)$/u;

/** One letter added, dropped or changed: "Judgement" for Judgment, "Caada" for Caçada. */
function oneEditApart(a: string, b: string): boolean {
	if (Math.abs(a.length - b.length) > 1) return false;
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	return (
		a.slice(i + 1) === b.slice(i + 1) ||
		a.slice(i + 1) === b.slice(i) ||
		a.slice(i) === b.slice(i + 1)
	);
}

/**
 * Whether a word belongs to one of the movie's titles, allowing for a dropped
 * possessive ("Dead Man Chest") and one misspelt letter.
 */
function inTitles(word: string, titleWords: Set<string>): boolean {
	if (titleWords.has(word) || titleWords.has(`${word}s`)) return true;
	if (word.endsWith('s') && titleWords.has(word.slice(0, -1))) return true;
	if (word.length < 5 || /\d/.test(word)) return false;
	for (const t of titleWords) if (t.length >= 5 && oneEditApart(word, t)) return true;
	return false;
}

/**
 * Whether the words between a title of the movie and the end of the release's
 * title leave the release named by that title. Of 560 DIFFERENT_TITLE releases
 * kept this way on four random draws on 2026-10-04, 220 were another work,
 * often another film of the series: Kill Bill Vol 1 on the Vol. 2 page, Scream
 * VI on Scream (2022), 28 Years Later The Bone Temple on 28 Years Later. So a
 * number the movie's own titles do not carry is another film, and so is any
 * word that is not the movie's, an edition's or a joining word: that trashes
 * 192 of the 220 and keeps 320 of the 328 that are the movie or a set holding
 * it. Two numbers are a set holding the movie ("Kill
 * Bill Vol 1 And 2", "Kill Bill 1, 2", "Ben-Hur 50th Anniversary Part 1-2"),
 * and an edition may be named anything ("Skynet Edition").
 */
function leavesItNamed(
	tail: string[],
	series: string[],
	titleWords: Set<string>,
	last: string
): boolean {
	if (tail.length === 0) return true;
	// A title word the release split: "Step Up 3-D" for Step Up 3D.
	tail = tail.filter((w, i) => !titleWords.has((i === 0 ? last : tail[i - 1]) + w));
	const isNumber = (w: string) => NUMBER.test(w) || w === 'one';
	const numbers = tail.filter(isNumber);
	const distinct = new Set(
		[...series, ...numbers].filter(isNumber).map((n) => (FIRST.test(n) ? '1' : n))
	);
	if (distinct.size >= 2) return true;
	const numbered = [...titleWords].some((w) => NUMBER.test(w) && !FIRST.test(w));
	for (const n of numbers) {
		if (titleWords.has(n)) continue;
		if (FIRST.test(n) && !numbered) continue;
		return false;
	}
	if (tail.some((w) => EDITION_NOUN.test(w))) return true;
	return tail.every(
		(w) =>
			NUMBER.test(w) ||
			w === 'one' ||
			inTitles(w, titleWords) ||
			INSTALMENT.test(w) ||
			EDITION_WORD.test(w) ||
			LINKING.test(w)
	);
}

/**
 * Whether the release is named `title`, not merely carrying its words inside a
 * longer one: "Warfare" is a whole-word run in The Ministry of Ungentlemanly
 * Warfare, and "Killers" in Lesbian Vampire Killers. `whole` also wants the
 * title to end where the release's does, so Baba Yaga is not Baba. Otherwise
 * what may follow is what `leavesItNamed` allows, given every title of the
 * movie (`titles`): an edition, as in "The Exorcist Extended Directors Cut",
 * but not another film of the series.
 */
export function namesRelease(
	filename: string,
	title: string,
	whole: boolean,
	titles: string[] = [title]
): boolean {
	const words = releaseWords(filename);
	const needle = fold(title);
	const forms = [needle];
	if (title.includes('&')) forms.push(fold(title.replace(/&/g, ' ')));
	const bare = needle.replace(LEADING_ARTICLE, ' ');
	if (bare !== needle && bare.trim().length >= 4) forms.push(bare);
	const titleWords = new Set(titles.flatMap((t) => fold(t).trim().split(' ')));

	for (const form of forms) {
		const run = form.trim().split(' ');
		for (let i = 0; i + run.length <= words.length; i++) {
			if (!words[i].starts) continue;
			if (!run.every((word, k) => words[i + k].text === word)) continue;
			let end = i + run.length;
			if (whole) {
				if (end === words.length || words[end].ends) return true;
				continue;
			}
			// The numbers of a set run on past a separator: "Kill Bill 1, 2".
			const series: string[] = [];
			for (let k = end; k < words.length; k++) {
				const w = words[k].text;
				if (!(NUMBER.test(w) || w === 'one' || INSTALMENT.test(w) || LINKING.test(w)))
					break;
				series.push(w);
			}
			const tail: string[] = [];
			while (end < words.length && !words[end].ends) tail.push(words[end++].text);
			if (leavesItNamed(tail, series, titleWords, run[run.length - 1])) return true;
		}
	}
	return false;
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
	// and year and the model reads the title as the movie's. Less is not enough:
	// aliases turn up in unrelated clips ("The Prisoner", "Dude", and "Ana", the
	// Turkish title of Mother, as a performer's name), so very short ones never count.
	const filmLike =
		media === 'FILM' ||
		media === 'UNCLEAR' ||
		(media === 'ADULT' &&
			nearYear &&
			titleMatch === 'SAME_TITLE' &&
			found.some((t) => fold(t).replace(/ /g, '').length >= 5));

	if (ADULT_TAG.test(filename)) return 'trash';

	const pack =
		packWordIn(filename, PACK, movie.titles) ||
		(titleMatch !== 'NO_TITLE' && packWordIn(filename, SERIES_PACK, movie.titles));
	if (pack && filmLike) {
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
	if (titleMatch === 'SAME_TITLE') return 'keep';
	// The model read another title, or none. A title found in code overrules it
	// only when the release is named by it: Warfare (2025) found inside The
	// Ministry of Ungentlemanly Warfare (2024), a year one off, kept that film on
	// the Warfare page. With NO_TITLE the title must also end where the
	// release's does ("Lost Found" for Lost & Found); with DIFFERENT_TITLE an
	// edition may follow it, but not another film's number or subtitle.
	const named = found.some((t) =>
		namesRelease(filename, t, titleMatch === 'NO_TITLE', movie.titles)
	);
	return named && nearYear ? 'keep' : 'trash';
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
