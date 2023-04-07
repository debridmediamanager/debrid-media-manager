import { ParsedFilename, ParsedShow } from '@ctrl/video-filename-parser';

const prefix = (char: string, num: number): string => `${char}${num < 10 ? '0' : ''}${num}`;

export const getMediaId = (info: ParsedFilename, mediaType: 'tv' | 'movie', lowerCase = true) => {
	const titleStr = lowerCase ? info.title.toLocaleLowerCase() : info.title;
	if (mediaType === 'tv') {
		const { seasons, fullSeason, isMultiSeason, episodeNumbers } = info as ParsedShow;
		if (fullSeason) {
			return `${titleStr} ${prefix('S', seasons[0])}`;
		} else if (isMultiSeason) {
			return `${titleStr} ${prefix('S', seasons[0])}${' '}
                ${prefix('S', seasons[seasons.length - 1])}`;
		}
		return `${titleStr} ${prefix('S', seasons[0])}${' '}
            ${prefix('E', episodeNumbers[0])}`;
	}
	return `${titleStr} (${info.year})`;
};
