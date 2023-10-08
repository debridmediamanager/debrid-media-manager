import { ScrapeSearchResult } from '@/services/mediasearch';
import { filenameParse } from '@ctrl/video-filename-parser';
import fs from 'fs';
import { cleanSearchQuery, liteCleanSearchQuery } from './search';

let dictionary: Set<string>;
try {
	let data = fs.readFileSync('./wordlist.txt', 'utf8');
	dictionary = new Set(data.toLowerCase().split('\n'));
} catch (err) {
	console.error('error loading wordlist', err);
}

let bannedWordSet: Set<string>;
try {
	let data = fs.readFileSync('./bannedwordlist.txt', 'utf8');
	bannedWordSet = new Set(data.toLowerCase().split('\n'));
} catch (err) {
	console.error('error loading banned wordlist', err);
}

export function naked(title: string): string {
	return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function grabYears(str: string): string[] {
	return (str.match(/\d{4}/g) ?? []).filter(
		(n) => parseInt(n, 10) > 1900 && parseInt(n, 10) <= new Date().getFullYear()
	);
}

export function grabSeasons(str: string): string[] {
	return (str.match(/\d+/g) ?? []).filter((n) => parseInt(n, 10) > 0 && parseInt(n, 10) <= 100);
}

export function hasYear(test: string, years: string[]) {
	return (
		years.filter((year) => {
			const intYear = parseInt(year);
			return (
				test.includes(year) ||
				test.includes(`${intYear + 1}`) ||
				test.includes(`${intYear - 1}`)
			);
		}).length > 0
	);
}

function removeDiacritics(str: string) {
	return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function removeRepeats(str: string) {
	return str.replace(/(.)\1+/g, '$1');
}

function flexEq(test: string, target: string, strict = false) {
	if (strict) {
		const movieTitle = filenameParse(test).title.toLowerCase();
		const tvTitle = filenameParse(test, true).title.toLowerCase();
		return (
			target === movieTitle ||
			removeRepeats(target) === removeRepeats(movieTitle) ||
			removeDiacritics(target) === removeDiacritics(movieTitle) ||
			target === tvTitle ||
			removeRepeats(target) === removeRepeats(tvTitle) ||
			removeDiacritics(target) === removeDiacritics(tvTitle)
		);
	}
	return (
		test.includes(target) ||
		removeRepeats(test).includes(removeRepeats(target)) ||
		removeDiacritics(test).includes(removeDiacritics(target))
	);
}

export function matchesTitle(target: string, year: string, test: string) {
	target = target.toLowerCase();
	test = test.toLowerCase();
	const containsYear = hasYear(test, [year]);

	// if title doesn't contain any spaces, then we can do a simple match
	if (!target.match(/\s/)) {
		// if title is common and title matches perfectly or not perfect but matches year, then we're good
		if (countUncommonWords(target) === 0) {
			return flexEq(test, target, true) || (flexEq(test, target) && containsYear);
		}
		// if title is uncommon single word, remove all non-alphanumeric characters
		const magicLength = 4;
		if (target.length >= magicLength && test.includes(target)) {
			return true;
		}
		// if title is uncommon single word, remove all non-alphanumeric characters
		let targetTitle2 = naked(target);
		let testTitle2 = naked(test);
		if (targetTitle2.length >= magicLength && testTitle2.includes(targetTitle2)) {
			return true;
		}
		return flexEq(test, target) && containsYear;
	}

	// if title is alphanumeric with spaces, then we can do a simple match
	if (target.match(/^[a-z0-9\s]+$/) !== null) {
		// remove spaces
		let targetTitle2 = target.replace(/\s/g, '');
		let testTitle2 = test.replace(/\s/g, '');
		const magicLength = 5;
		// console.log('🎯 Comparison:', targetTitle2, testTitle2, targetTitle2.length >= magicLength && testTitle2.includes(targetTitle2), flexEq(testTitle2, targetTitle2) && containsYear);
		if (targetTitle2.length >= magicLength && testTitle2.includes(targetTitle2)) {
			return true;
		} else if (flexEq(testTitle2, targetTitle2) && containsYear) {
			return true;
		}
	}
	// if title is alphanumeric with symbols and spaces
	let targetTitle2 = target.replace(/\s/g, '');
	let testTitle2 = test.replace(/\s/g, '');
	let targetTitle3 = naked(targetTitle2);
	let testTitle3 = naked(testTitle2);
	const magicLength = 5;
	if (targetTitle3.length >= magicLength && testTitle3.includes(targetTitle3)) {
		return true;
	} else if (targetTitle2.length >= magicLength && testTitle2.includes(targetTitle2)) {
		return true;
	} else if (flexEq(testTitle2, targetTitle2) && containsYear) {
		return true;
	}

	// last chance
	const splits = target.split(/\s+/);
	if (splits.length > 4) {
		let test2 = test;
		const actual = splits.filter((term) => {
			let newTest = test2.replace(term, '');
			if (newTest !== test2) {
				test2 = newTest;
				return true;
			}

			newTest = test2.replace(removeDiacritics(term), '');
			if (newTest !== test2) {
				test2 = newTest;
				return true;
			}

			newTest = test2.replace(removeRepeats(term), '');
			if (newTest !== test2) {
				test2 = newTest;
				return true;
			}
			return false;
		});
		// console.log('🎯 Comparison3:', actual, splits.length);
		if (actual.length + 1 >= splits.length) {
			return true;
		}
	}
	const mustHaveTerms: string[] = splits;
	// console.log('🎯 Comparison2:', mustHaveTerms, test, containsYear);
	return containsYear && includesMustHaveTerms(mustHaveTerms, test);
}

export function includesMustHaveTerms(mustHaveTerms: string[], testTitle: string) {
	return mustHaveTerms.every((term) => {
		let newTitle = testTitle.replace(term, '');
		if (newTitle !== testTitle) {
			testTitle = newTitle;
			return true;
		}

		newTitle = testTitle.replace(removeDiacritics(term), '');
		if (newTitle !== testTitle) {
			testTitle = newTitle;
			return true;
		}

		newTitle = testTitle.replace(removeRepeats(term), '');
		if (newTitle !== testTitle) {
			testTitle = newTitle;
			return true;
		}
		return false;
	});
}

export function hasNoBannedTerms(targetTitle: string, testTitle: string): boolean {
	let processedTitle = filenameParse(testTitle)
		.title.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word: string) => word.length >= 3);
	return (
		processedTitle.filter(
			(word: string) => !targetTitle.includes(word) && bannedWordSet.has(word)
		).length === 0
	);
}

export function meetsTitleConditions(
	targetTitle: string,
	year: string,
	testTitle: string
): boolean {
	// console.log('🎯 Target title:', targetTitle);
	// console.log('🎯 Test title:', testTitle);
	// console.log('🎯 Year:', year);
	// console.log('🎯 matchesTitle:', matchesTitle(targetTitle, year, testTitle));
	return matchesTitle(targetTitle, year, testTitle) && hasNoBannedTerms(targetTitle, testTitle);
}

export function countUncommonWords(title: string) {
	let processedTitle = title
		.split(/\s+/)
		.map((word: string) =>
			word.toLowerCase().replace(/'s/g, '').replace(/\s&\s/g, '').replace(/[\W]+/g, '')
		)
		.filter((word: string) => word.length > 3);
	return processedTitle.filter((word: string) => !dictionary.has(word)).length;
}

export function grabMovieMetadata(imdbId: string, tmdbData: any, mdbData: any) {
	const cleanTitle = cleanSearchQuery(tmdbData.title);
	const liteCleantitle = liteCleanSearchQuery(tmdbData.title);
	console.log(
		`🏹 Movie: ${cleanTitle} Y${
			mdbData.year ?? 'year'
		} (${imdbId}) (uncommon: ${countUncommonWords(tmdbData.title)})`
	);
	const year: string =
		mdbData.year ?? mdbData.released?.substring(0, 4) ?? tmdbData.release_date?.substring(0, 4);
	const airDate: string = mdbData.released ?? tmdbData.release_date ?? '2000-01-01';
	let originalTitle: string | undefined, cleanedTitle: string | undefined;

	const processedTitle = tmdbData.title
		.split(' ')
		.map((word: string) => word.replace(/[\W]+/g, ''))
		.join(' ')
		.trim()
		.toLowerCase();

	if (
		tmdbData.original_title &&
		tmdbData.original_title !== tmdbData.title &&
		mdbData.ratings?.length
	) {
		originalTitle = tmdbData.original_title.toLowerCase();
		console.log(
			'🎯 Found original title:',
			originalTitle,
			`(uncommon: ${countUncommonWords(originalTitle!)})`
		);
		for (let rating of mdbData.ratings) {
			if (rating.source === 'tomatoes' && rating.score > 0) {
				if (!rating.url) continue;
				let tomatoTitle = rating.url.split('/').pop();
				if (tomatoTitle.match(/^\d{6,}/)) continue;
				tomatoTitle = tomatoTitle
					.split('_')
					.map((word: string) => word.replace(/[\W]+/g, ''))
					.join(' ')
					.trim()
					.toLowerCase();
				if (tomatoTitle !== processedTitle) {
					console.log(
						'🎯 Found tomato title:',
						tomatoTitle,
						`(uncommon: ${countUncommonWords(tomatoTitle)})`
					);
					cleanedTitle = tomatoTitle;
				}
			}
		}
	}

	let alternativeTitle: string | undefined;
	if (mdbData.ratings?.length) {
		for (let rating of mdbData.ratings) {
			if (rating.source === 'metacritic' && rating.score > 0) {
				if (!rating.url) continue;
				let metacriticTitle = rating.url.split('/').pop();
				if (metacriticTitle.startsWith('-')) continue;
				metacriticTitle = metacriticTitle
					.split('-')
					.map((word: string) => word.replace(/[\W]+/g, ''))
					.join(' ')
					.trim()
					.toLowerCase();
				if (metacriticTitle !== processedTitle && metacriticTitle !== cleanedTitle) {
					console.log(
						'🎯 Found metacritic title:',
						metacriticTitle,
						`(uncommon: ${countUncommonWords(metacriticTitle)})`
					);
					alternativeTitle = metacriticTitle;
				}
			}
		}
	}
	if (cleanTitle !== liteCleantitle) {
		console.log('🎯 Title with symbols:', liteCleantitle);
	}

	return {
		cleanTitle,
		originalTitle,
		titleWithSymbols: cleanTitle !== liteCleantitle ? liteCleantitle : undefined,
		alternativeTitle,
		cleanedTitle,
		year,
		airDate,
	};
}

const getSeasons = (mdbData: any) =>
	mdbData.seasons.length
		? mdbData.seasons
		: [{ name: 'Season 1', season_number: 1, episode_count: 0 }];

export function grabTvMetadata(imdbId: string, tmdbData: any, mdbData: any) {
	const cleanTitle = cleanSearchQuery(tmdbData.name);
	const liteCleantitle = liteCleanSearchQuery(tmdbData.name);
	console.log(
		`🏏 ${getSeasons(mdbData).length} season(s) of tv show: ${tmdbData.name} (${imdbId})...`
	);
	const year: string =
		mdbData.year ?? mdbData.released?.substring(0, 4) ?? tmdbData.release_date?.substring(0, 4);
	let originalTitle: string | undefined, cleanedTitle: string | undefined;

	const processedTitle = tmdbData.name
		.split(' ')
		.map((word: string) => word.replace(/[\W]+/g, ''))
		.join(' ')
		.trim()
		.toLowerCase();

	if (
		tmdbData.original_name &&
		tmdbData.original_name !== tmdbData.name &&
		mdbData.ratings?.length
	) {
		originalTitle = tmdbData.original_name.toLowerCase();
		console.log(
			'🎯 Found original title:',
			originalTitle,
			`(uncommon: ${countUncommonWords(originalTitle!)})`
		);
		for (let rating of mdbData.ratings) {
			if (rating.source === 'tomatoes' && rating.score > 0) {
				if (!rating.url) continue;
				let tomatoTitle = rating.url.split('/').pop();
				if (tomatoTitle.match(/^\d{6,}/)) continue;
				tomatoTitle = tomatoTitle
					.split('_')
					.map((word: string) => word.replace(/[\W]+/g, ''))
					.join(' ')
					.trim()
					.toLowerCase();
				if (tomatoTitle !== processedTitle) {
					console.log(
						'🎯 Found tomato title:',
						tomatoTitle,
						`(uncommon: ${countUncommonWords(tomatoTitle)})`
					);
					cleanedTitle = tomatoTitle;
				}
			}
		}
	}

	let alternativeTitle: string | undefined;
	if (mdbData.ratings?.length) {
		for (let rating of mdbData.ratings) {
			if (rating.source === 'metacritic' && rating.score > 0) {
				if (!rating.url) continue;
				let metacriticTitle = rating.url.split('/').pop();
				if (metacriticTitle.startsWith('-')) continue;
				metacriticTitle = metacriticTitle
					.split('-')
					.map((word: string) => word.replace(/[\W]+/g, ''))
					.join(' ')
					.trim()
					.toLowerCase();
				if (metacriticTitle !== processedTitle && metacriticTitle !== cleanedTitle) {
					console.log(
						'🎯 Found metacritic title:',
						metacriticTitle,
						`(uncommon: ${countUncommonWords(metacriticTitle)})`
					);
					alternativeTitle = metacriticTitle;
				}
			}
		}
	}
	if (cleanTitle !== liteCleantitle) {
		console.log('🎯 Title with symbols:', liteCleantitle);
	}

	return {
		cleanTitle,
		originalTitle,
		titleWithSymbols: cleanTitle !== liteCleantitle ? liteCleantitle : undefined,
		alternativeTitle,
		cleanedTitle,
		year,
		seasons: getSeasons(mdbData),
	};
}

export function getAllPossibleTitles(titles: (string | undefined)[]) {
	const ret: string[] = [];
	titles.forEach((title) => {
		if (title) {
			ret.push(title);
			if (title.match(/[a-z\s]&/i)) {
				ret.push(title.replace(/&/g, ' and '));
			}
			if (title.match(/[a-z\s]\+/i)) {
				ret.push(title.replace(/\+/g, ' and '));
			}
			if (title.match(/[a-z\s]@/i)) {
				ret.push(title.replace(/@/g, ' at '));
			}
		}
	});
	return ret;
}

export function filterByMovieConditions(title: string, year: string, items: ScrapeSearchResult[]) {
	return items
		.filter((result) => !/s\d\de\d\d/i.test(result.title))
		.filter((result) => result.fileSize < 200000 && result.fileSize > 500)
		.filter((result) => {
			const yearsFromTitle = grabYears(title);
			const yearsFromFile = grabYears(result.title).filter(
				(y) => !yearsFromTitle.includes(y)
			);
			return (
				(yearsFromFile.length > 0 && hasYear(result.title, [year])) ||
				yearsFromFile.length === 0
			);
		});
}

export function filterByTvConditions(
	items: ScrapeSearchResult[],
	title: string,
	firstYear: string,
	seasonYear: string | undefined,
	seasonNumber: number,
	seasonName: string | undefined,
	seasonCode: number | undefined
) {
	return items
		.filter((result) => result.fileSize > 100)
		.filter((result) => {
			const yearsFromTitle = grabYears(title);
			const yearsFromFile = grabYears(result.title).filter(
				(y) => !yearsFromTitle.includes(y)
			);
			const years = [firstYear, seasonYear].filter((y) => y !== undefined) as string[];
			return (
				(yearsFromFile.length > 0 && hasYear(result.title, years)) ||
				yearsFromFile.length === 0
			);
		})
		.filter((result) => {
			// drop 3xRus or 1xEng or AC3
			let regex =
				/\b(\d)x([a-z]+)\b|\bac3\b|\b5\.1|\bmp4|\bav1|\br[1-6]|\bdvd\-?\d|\bp2p|\bbd\d+/gi;
			let resultTitle = result.title.replace(regex, '');

			if (resultTitle.match(/\bs\d\de?/i)) {
				const season = parseInt(resultTitle.match(/s(\d\d)e?/i)![1]);
				return season === seasonNumber || season === seasonCode;
			}

			const seasons = grabSeasons(resultTitle);
			if (
				seasonName &&
				seasonCode &&
				flexEq(naked(seasonName), naked(result.title)) &&
				seasons.filter((s) => parseInt(s) === seasonCode).length > 0
			) {
				// console.log(
				// 	'🎯 Found season name and code in title:',
				// 	seasonName,
				// 	seasonCode,
				// 	result.title,
				// 	seasons
				// );
				return true;
			}
			if (seasonName && seasonName !== title && flexEq(resultTitle, seasonName)) {
				// console.log(
				// 	'🎯 Found season name only in title:',
				// 	seasonName,
				// 	result.title,
				// 	seasons
				// );
				return true;
			}
			if (
				seasons.filter((s) => parseInt(s) === seasonNumber || parseInt(s) === seasonCode)
					.length > 0
			) {
				// console.log(
				// 	'🎯 Found season number only in title:',
				// 	seasonNumber,
				// 	seasonCode,
				// 	result.title,
				// 	seasons
				// );
				return true;
			}
			// it can contain no numbers if it's still season 1 (or only season 1)
			// console.log('🎯 Season number 1:', result.title, seasons);
			return seasonNumber === 1 && grabSeasons(resultTitle).length === 0;
		});
}

export function padWithZero(num: number) {
	if (num < 10) {
		return '0' + num;
	} else {
		return num.toString();
	}
}

export const getSeasonNameAndCode = (season: any) => {
	let seasonName, seasonCode;
	let parts = season.name.split(/\s+/);
	for (let i = parts.length - 1; i >= 0; i--) {
		let match = parts[i].match(/\(?(\d+)\)?$/);
		if (match) {
			seasonCode = parseInt(match[1]);
			parts[i] = '';
			break;
		}
	}
	seasonName = cleanSearchQuery(parts.join(' ').trim());
	if (/series|season/.test(seasonName)) seasonName = undefined;
	return { seasonName, seasonCode };
};

export const getSeasonYear = (season: any) => season.air_date?.substring(0, 4);
