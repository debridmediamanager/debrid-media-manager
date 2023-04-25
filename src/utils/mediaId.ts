import { ParsedMovie, ParsedShow } from '@ctrl/video-filename-parser';

const prefix = (char: string, num: number): string => `${char}${num < 10 ? '0' : ''}${num}`;

export const getMediaId = (
	info: ParsedMovie | ParsedShow,
	mediaType: 'tv' | 'movie',
	systemOnlyId = true,
	tvShowTitleOnly = false
) => {
	if (mediaType === 'movie')
		return `${systemOnlyId ? info.title.toLocaleLowerCase() : info.title}${
			info.year ? ` (${info.year})` : ''
		}`;

	const { title, seasons, fullSeason, isMultiSeason, episodeNumbers } = info as ParsedShow;
	const titleStr = systemOnlyId ? title.toLocaleLowerCase() : title;
	if (tvShowTitleOnly) {
		return titleStr;
	}
	if (seasons.length === 0) return titleStr;
	if (fullSeason) {
		return `${titleStr} ${prefix('S', seasons[0])}`;
	} else if (isMultiSeason) {
		return `${titleStr} ${prefix('S', seasons[0])}${'-'}
			${prefix('S', seasons[seasons.length - 1])}`;
	}
	return `${titleStr} ${prefix('S', seasons[0])}${' '}
		${prefix('E', episodeNumbers[0])}`;
};
