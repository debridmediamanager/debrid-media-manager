import { ParsedMovie, ParsedShow } from '@ctrl/video-filename-parser';

// Prefixes a number with a character and leading zero if necessary
const prefix = (char: string, num: number): string => `${char}${num < 10 ? '0' : ''}${num}`;

export const getMediaId = (
	info: ParsedMovie | ParsedShow | string,
	mediaType: 'tv' | 'movie',
	systemOnlyId = true,
	tvShowTitleOnly = false
) => {
	// Check if info is string and assign titleId accordingly
	const titleId: string = typeof info === 'string' ? info : info.title;

	// If media type is movie, return formatted string
	if (mediaType === 'movie') {
		return `${systemOnlyId ? titleId.toLocaleLowerCase() : titleId}${
			typeof info !== 'string' && info.year ? ` (${info.year})` : ''
		}`;
	}

	// If info is string or only the title of the TV show is required, return titleId
	if (typeof info === 'string' || tvShowTitleOnly) {
		return systemOnlyId ? titleId.toLocaleLowerCase() : titleId;
	}

	// Destructure info of type ParsedShow
	const { title, seasons, fullSeason, isMultiSeason, episodeNumbers } = info as ParsedShow;

	// Format title string
	const titleStr = systemOnlyId ? title.toLocaleLowerCase() : title;

	// If seasons are not present or empty, return title string
	if (!seasons || seasons.length === 0) return titleStr;

	// Define season and episode prefixes
	const seasonPrefix = systemOnlyId ? 's' : 'S';
	const episodePrefix = systemOnlyId ? 'e' : 'E';

	// Handle multi-season case
	if (isMultiSeason) {
		return `${titleStr} ${prefix(seasonPrefix, Math.min(...seasons))}-${prefix(
			seasonPrefix,
			Math.max(...seasons)
		)}`;
	}

	// Handle full season case
	else if (fullSeason) {
		return `${titleStr} ${prefix(seasonPrefix, Math.min(...seasons))}`;
	}

	// Handle single episode case
	else if (episodeNumbers && episodeNumbers.length > 0) {
		return `${titleStr} ${prefix(seasonPrefix, Math.min(...seasons))}${prefix(
			episodePrefix,
			episodeNumbers[0]
		)}`;
	}

	// Default case, return title and season without episode
	return `${titleStr} ${prefix(seasonPrefix, Math.min(...seasons))}`;
};
