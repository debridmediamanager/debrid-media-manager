import { some } from 'lodash';
import { checkArithmeticSequenceInFilenames } from './selectable';

export const getTypeByName = (filename: string): 'tv' | 'movie' => {
	return /(season|episode)s?.?\d?/i.test(filename) ||
		/[se]\d\d/i.test(filename) ||
		/\b(tv|complete)/i.test(filename) ||
		/\b(saison|stage).?\d/i.test(filename) ||
		/[a-z]\s?\-\s?\d{2,4}\b/.test(filename) ||
		/\d{2,4}\s?\-\s?\d{2,4}\b/.test(filename)
		? 'tv'
		: 'movie';
};

export const getTypeByFilenames = (filename: string, filenames: string[]) => {
	if (
		checkArithmeticSequenceInFilenames(filenames) ||
		some(filenames, (f) => /s\d\d\d?e\d\d\d?/i.test(f)) ||
		some(filenames, (f) => /season \d+/i.test(f)) ||
		some(filenames, (f) => /episode \d+/i.test(f)) ||
		some(filenames, (f) => /\b[a-fA-F0-9]{8}\b/.test(f))
	) {
		return 'tv';
	}
	return getTypeByName(filename);
};

export const getTypeByNameAndFileCount = (filename: string): 'tv' | 'movie' => {
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
	return 'movie';
};
