import { ParsedFilename, ParsedShow } from '@ctrl/video-filename-parser';

const prefix = (char: string, num: number): string => `${char}${num < 10 ? '0' : ''}${num}`;

export const getMediaId = (
	info: ParsedFilename,
	mediaType: 'tv' | 'movie',
	lowerCase = true,
	titleOnly = false
) => {
	if (mediaType === 'tv') {
		const { title, seasons, fullSeason, isMultiSeason, episodeNumbers } = info as ParsedShow;
		const titleStr = lowerCase ? title.toLocaleLowerCase() : title;
		if (titleOnly) {
			return titleStr;
		}
		if (fullSeason) {
			return `${titleStr} ${prefix('S', seasons[0])}`;
		} else if (isMultiSeason) {
			return `${titleStr} ${prefix('S', seasons[0])}${' '}
                ${prefix('S', seasons[seasons.length - 1])}`;
		}
		return `${titleStr} ${prefix('S', seasons[0])}${' '}
            ${prefix('E', episodeNumbers[0])}`;
	}
	return `${lowerCase ? info.title.toLocaleLowerCase() : info.title} (${info.year})`;
};
