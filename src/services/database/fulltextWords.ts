// MySQL InnoDB default stopwords: never indexed, so a required (+) one matches nothing.
export const FULLTEXT_STOPWORDS = new Set([
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
 * Words in millions of IMDb titles, from its "Episode #1.2" and "Episode dated
 * 3 March 2001" episode names (dmmdb, 2026-11-11): "episode" in 5.5M basics and
 * 10.9M akas rows, "dated" in 1.1M basics; the next word measured was "part" at
 * 121k. A search holding one builds its whole match set in MySQL's full-text result
 * cache: "star wars episode" took 0.9-2 GB and 7-14 s for 781 rows, and those caches
 * ran mysqld out of memory (OOM kill 2026-11-10 04:30:57, 93 s with no database).
 */
const FULLTEXT_HOT_WORDS = ['episode', 'dated'];

// The IMDb tables' collation ignores accents: "Épisode" matched the same 10.9M rows.
const folded = (word: string) => word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export const isHotWord = (word: string): boolean => FULLTEXT_HOT_WORDS.includes(folded(word));

/** True for a word that is a hot word or the start of one ("epi" expands to "episode"). */
export const startsHotWord = (word: string): boolean =>
	FULLTEXT_HOT_WORDS.some((hot) => hot.startsWith(folded(word)));

/**
 * The phrase as required words the full-text index holds, without hot words:
 * "Star Wars: Episode IV - A New Hope" -> "+Star +Wars +New +Hope". Null when no
 * such word is left.
 */
export function requiredIndexedWords(phrase: string): string | null {
	const words = phrase
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w.length >= 3 && !FULLTEXT_STOPWORDS.has(w.toLowerCase()) && !isHotWord(w));
	return words.length > 0 ? words.map((w) => `+${w}`).join(' ') : null;
}
