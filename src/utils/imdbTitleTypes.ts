/**
 * IMDb title types, and the DMM page each one opens.
 *
 * DMM renders only `/movie/tt…` and `/show/tt…/N`. Search, transfer filing and
 * scrape verdicts all have to agree on which types go where. Each kept its own
 * list until 2026-09-29, and search's was the short one: it left out every
 * direct-to-video and TV film, so the Futurama films (`video`) and A Charlie
 * Brown Christmas (`tvMovie`) could be opened but never found.
 */

export const SHOW_TITLE_TYPES = ['tvSeries', 'tvMiniSeries'] as const;

/**
 * Types with a movie page besides the theatrical `movie`. Most titles of these
 * types are featurettes and making-ofs, so search asks more of them.
 */
export const NON_THEATRICAL_MOVIE_TYPES = [
	'tvMovie',
	'video',
	'short',
	'tvSpecial',
	'tvShort',
] as const;

export const MOVIE_TITLE_TYPES = ['movie', ...NON_THEATRICAL_MOVIE_TYPES] as const;

export function isShowTitleType(titleType: string | null | undefined): boolean {
	return (SHOW_TITLE_TYPES as readonly string[]).includes(titleType ?? '');
}

export function isMovieTitleType(titleType: string | null | undefined): boolean {
	return (MOVIE_TITLE_TYPES as readonly string[]).includes(titleType ?? '');
}
