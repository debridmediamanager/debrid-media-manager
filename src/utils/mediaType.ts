export const getMediaType = (filename: string): 'tv' | 'movie' => {
	return /seasons?.\d/i.test(filename) ||
		/s\d\d/i.test(filename) ||
		/\b(tv|complete)/i.test(filename) ||
		/\b(saison|stage)[\s\.]?\d/i.test(filename)
		? 'tv'
		: 'movie';
};

export const getMediaType2 = (filename: string, linkCount: number): 'tv' | 'movie' => {
	if (
		/seasons?.\d/i.test(filename) ||
		/s\d\d/i.test(filename) ||
		/\b(tv|complete)/i.test(filename) ||
		/\b(saison|stage)[\s\.]?\d/i.test(filename)
	) {
		return 'tv';
	}
	if (linkCount > 3) {
		return 'tv';
	}
	return 'movie';
};
