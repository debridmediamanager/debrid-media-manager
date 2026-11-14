// `Show - 05` is an episode; `big-buck-bunny-2008` is a film's year, not episode 2008.
export const getTypeByName = (filename: string): 'tv' | 'movie' => {
	return /(season|episode)s?.?\d?/i.test(filename) ||
		/[se]\d\d/i.test(filename) ||
		/\b(tv|complete)/i.test(filename) ||
		/\b(saison|stage).?\d/i.test(filename) ||
		/[a-z]\s?\-\s?(?!(?:19|20)\d\d\b)\d{2,4}\b/.test(filename) ||
		/\d{2,4}\s?\-\s?\d{2,4}\b/.test(filename)
		? 'tv'
		: 'movie';
};

export const getTypeByNameAndFileCount = (filename: string): 'tv' | 'movie' => {
	if (
		/(season|episode)s?.?\d/i.test(filename) ||
		/[se]\d\d/i.test(filename) ||
		/\b(tv|complete)/i.test(filename) ||
		/\b(saison|stage).?\d/i.test(filename) ||
		/[a-z]\s?\-\s?(?!(?:19|20)\d\d\b)\d{2,4}\b/.test(filename) ||
		/\d{2,4}\s?\-\s?\d{2,4}\b/.test(filename)
	) {
		return 'tv';
	}
	return 'movie';
};
