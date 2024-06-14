import { ParsedMovie, ParsedShow } from '@ctrl/video-filename-parser';
import { deburr, replace, toLower } from 'lodash';

// Prefixes a number with a character and leading zero if necessary
const prefix = (char: string, num: number): string => `${char}${num < 10 ? '0' : ''}${num}`;

function isArrayContinuouslyIncreasing(array: number[]) {
	for (let i = 1; i < array.length; i++) {
		if (array[i] <= array[i - 1]) {
			return false;
		}
	}
	return true;
}

export function normalize(str: string) {
	return replace(toLower(deburr(str)), /[^a-z0-9\p{L}\p{N}]/gu, '');
}

export const getMediaId = (
	info: ParsedMovie | ParsedShow | string,
	mediaType: 'tv' | 'movie' | 'other',
	systemOnlyId = true,
	tvShowTitleOnly = false
) => {
	let mediaId = '';

	const titleId: string = typeof info === 'string' ? info : info.title;

	if (mediaType === 'movie') {
		mediaId = `${titleId}${typeof info !== 'string' && info.year ? ` (${info.year})` : ''}`;
	} else if (typeof info === 'string' || tvShowTitleOnly) {
		mediaId = titleId;
	} else {
		// anime: \[[\da-z]{8}\]
		let { title, seasons, episodeNumbers } = info as ParsedShow;
		if (!seasons) seasons = [];
		if (!episodeNumbers) episodeNumbers = [];
		if (seasons.length > 1) {
			if (isArrayContinuouslyIncreasing(seasons)) {
				mediaId = `${title} ➡️ ${prefix('S', seasons[0])} to ${prefix(
					'S',
					seasons[seasons.length - 1]
				)}`;
			} else {
				mediaId = `${title} ➡️ ${seasons.map((season) => prefix('S', season)).join(', ')}`;
			}
		} else if (seasons.length === 1) {
			if (episodeNumbers.length === 1) {
				mediaId = `${title} ➡️ ${prefix('S', seasons[0])}${prefix('E', episodeNumbers[0])}`;
			} else {
				mediaId = `${title} ➡️ ${prefix('S', seasons[0])}`;
			}
		} else if (episodeNumbers.length > 0) {
			seasons = [1];
			mediaId = `${title} ➡️ ${prefix('S', seasons[0])}${prefix('E', episodeNumbers[0])}`;
		} else {
			mediaId = `${title}`;
		}
	}

	mediaId = mediaId
		.split(' ')
		.filter((t) => t)
		.join(' ')
		.trim();

	if (systemOnlyId) {
		mediaId = mediaId.toLowerCase();
	}

	return mediaId;
};
