/**
 * Languages whose local titles DMM accepts as a title's own. A German upload of
 * Puffin Rock is named "Oonas und Babas Insel", which TMDB lists only as the
 * German translation, not as an alternative title, and IMDb not at all. Every
 * TMDB language added 34% more names on 119 scraped titles (2026-11-07), mostly
 * Chinese, Hebrew, Korean and Thai, which the scraped sites' releases do not
 * carry; these twelve added 6%. btdig-scraper searches the same set.
 */
export const TRANSLATION_LANGUAGES = new Set([
	'de',
	'fr',
	'es',
	'it',
	'pt',
	'pl',
	'ru',
	'uk',
	'cs',
	'hu',
	'nl',
	'tr',
]);

/** A title's names in TRANSLATION_LANGUAGES, from TMDB's appended `translations`, each once. */
export function tmdbTranslatedTitles(tmdb: any): string[] {
	const list = tmdb?.translations?.translations;
	if (!Array.isArray(list)) return [];
	const titles = list
		.filter((t: any) => TRANSLATION_LANGUAGES.has(t?.iso_639_1))
		// films carry `title`, shows `name`; an untranslated entry leaves it empty
		.map((t: any) => t?.data?.title || t?.data?.name)
		.filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0);
	return [...new Set(titles)];
}
