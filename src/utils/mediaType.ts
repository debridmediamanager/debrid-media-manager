export const getTypeByName = (filename: string): 'tv' | 'movie' => {
	return /(season|episode)s?.?\d/i.test(filename) ||
		/[se]\d\d/i.test(filename) ||
		/\b(tv|complete)/i.test(filename) ||
		/\b(saison|stage).?\d/i.test(filename) ||
		/[a-z]\s?\-\s?\d{2,4}\b/.test(filename) ||
		/\d{2,4}\s?\-\s?\d{2,4}\b/.test(filename)
		? 'tv'
		: 'movie';
};

export const getTypeByNameAndFileCount = (filename: string, linkCount: number): 'tv' | 'movie' => {
	if (
		/(season|episode)s?.?\d/i.test(filename) ||
		/[se]\d\d/i.test(filename) ||
		/\b(tv|complete)/i.test(filename) ||
		/\b(saison|stage).?\d/i.test(filename) ||
		/[a-z]\s?\-\s?\d{2,4}\b/.test(filename) ||
		/\d{2,4}\s?\-\s?\d{2,4}\b/.test(filename)
	) {
		return 'tv';
	}
	if (linkCount > 3) {
		return 'tv';
	}
	return 'movie';
};
