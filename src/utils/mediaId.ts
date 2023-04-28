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
	const season = systemOnlyId ? 's' : 'S';
	const episode = systemOnlyId ? 'e' : 'E';
	if (fullSeason) {
		return `${titleStr} ${prefix(season, Math.min(...seasons))}`;
	} else if (isMultiSeason) {
		return `${titleStr} ${prefix(season, Math.min(...seasons))}${'-'}${prefix(
			season,
			Math.max(...seasons)
		)}`;
	}
	return `${titleStr} ${prefix(season, Math.min(...seasons))}${prefix(
		episode,
		episodeNumbers[0]
	)}`;
};
