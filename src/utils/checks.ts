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

let bannedWordSet2: Array<string>;
try {
	let data = fs.readFileSync('./bannedwordlist2.txt', 'utf8');
	bannedWordSet2 = data.toLowerCase().split('\n');
} catch (err) {
	console.error('error loading banned wordlist 2', err);
}

export function naked(title: string): string {
	return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function grabYears(str: string): string[] {
	return (str.match(/\d{4}/g) ?? []).filter(
		(n) => parseInt(n, 10) > 1900 && parseInt(n, 10) <= new Date().getFullYear()
	);
}

export function grabPossibleSeasonNums(str: string): number[] {
	return (str.match(/\d+/g) ?? []).map((n) => parseInt(n, 10)).filter((n) => n > 0 && n <= 100);
}

export function hasYear(test: string, years: string[], strictCheck: boolean = false) {
	return strictCheck
		? years.some((year) => test.includes(year))
		: years.filter((year) => {
				const intYear = parseInt(year);
				return (
					test.includes(year) ||
					test.includes(`${intYear + 1}`) ||
					test.includes(`${intYear - 1}`)
				);
		  }).length > 0;
}

function removeDiacritics(str: string) {
	return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function removeRepeats(str: string) {
	return str.replace(/(.)\1+/g, '$1');
}

function romanToDecimal(roman: string): number {
	const romanNumerals: { [key: string]: number } = {
		I: 1,
		V: 5,
		X: 10,
		L: 50,
		C: 100,
		D: 500,
		M: 1000,
	};
	let total = 0;
	let prevValue = 0;

	for (let i = roman.length - 1; i >= 0; i--) {
		const currentValue = romanNumerals[roman[i].toUpperCase()];
		if (currentValue < prevValue) {
			total -= currentValue;
		} else {
			total += currentValue;
		}
		prevValue = currentValue;
	}

	return total;
}

function replaceRomanWithDecimal(input: string): string {
	const romanRegex = /m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})/g;
	return input.replace(romanRegex, (match) => romanToDecimal(match).toString());
}

function strictEqual(title1: string, title2: string) {
	title1 = title1.replace(/\s+/g, '');
	title2 = title2.replace(/\s+/g, '');
	return (
		(title1.length && title1 === title2) ||
		(naked(title1).length && naked(title1) === naked(title2)) ||
		(removeRepeats(title1).length && removeRepeats(title1) === removeRepeats(title2)) ||
		(removeDiacritics(title1).length && removeDiacritics(title1) === removeDiacritics(title2))
	);
}

function countTestTermsInTarget(test: string, target: string, shouldBeInSequence = false): number {
	let replaceCount = 0;
	let prevReplaceCount = 0;
	let prevOffset = 0;
	let prevLength = 0;
	const wordTolerance = 5;

	const wordsInTitle = target.split(/\W+/).filter((e) => e);
	const magicLength = 3;
	let testStr = test;

	let inSequenceTerms = 1;
	let longestSequence = 0;

	const replacer = (match: string, offset: number, str: string) => {
		if (shouldBeInSequence && prevLength > 0 && offset >= wordTolerance) {
			if (inSequenceTerms > longestSequence) longestSequence = inSequenceTerms;
			inSequenceTerms = 0;
		}
		// if (checkSequence) console.log(`🎅 found '${match}' on offset:${offset} in '${str}'`);
		prevOffset = offset;
		prevLength = match.length;
		replaceCount++;
		inSequenceTerms++;
		return match;
	};

	const wrapReplace = (newTerm: string, first: boolean = false, last: boolean = false) => {
		let prefix = '';
		if (first) prefix = '\\b';
		let suffix = '';
		if (last) suffix = '\\b';
		testStr.replace(new RegExp(`${prefix}${newTerm}${suffix}`), replacer);
	};

	const actual = wordsInTitle.filter((term: string, idx: number) => {
		const first = idx === 0;
		const last = idx === wordsInTitle.length - 1;
		testStr = testStr.substring(prevOffset + prevLength);
		wrapReplace(term, first, last);
		if (replaceCount > prevReplaceCount) {
			prevReplaceCount = replaceCount;
			return true;
		}
		if (removeDiacritics(term).length >= magicLength) {
			wrapReplace(removeDiacritics(term), first, last);
			if (replaceCount > prevReplaceCount) {
				prevReplaceCount = replaceCount;
				return true;
			}
		}
		if (removeRepeats(term).length >= magicLength) {
			wrapReplace(removeRepeats(term), first, last);
			if (replaceCount > prevReplaceCount) {
				prevReplaceCount = replaceCount;
				return true;
			}
		}
		if (naked(term).length >= magicLength) {
			wrapReplace(naked(term), first, last);
			if (replaceCount > prevReplaceCount) {
				prevReplaceCount = replaceCount;
				return true;
			}
		}
		if (replaceRomanWithDecimal(term) !== term) {
			wrapReplace(replaceRomanWithDecimal(term), first, last);
			if (replaceCount > prevReplaceCount) {
				// console.log(`Finding ${replaceRomanWithDecimal(term)} in ${testStr} 🐲`)
				prevReplaceCount = replaceCount;
				return true;
			}
		}
		return false;
	});

	if (shouldBeInSequence && inSequenceTerms > longestSequence) {
		return inSequenceTerms;
	} else if (shouldBeInSequence && inSequenceTerms < longestSequence) {
		return longestSequence;
	}
	return actual.length;
}

function flexEq(test: string, target: string, years: string[]) {
	const movieTitle = filenameParse(test).title.toLowerCase();
	const tvTitle = filenameParse(test, true).title.toLowerCase();

	const target2 = target.replace(/\s+/g, '');
	const test2 = test.replace(/\s+/g, '');

	let magicLength = 5; // Math.ceil(magicLength*1.5) = 8
	if (hasYear(test, years)) magicLength = 3; // Math.ceil(magicLength*1.5) = 5

	if (naked(target2).length >= magicLength && naked(test2).includes(naked(target2))) {
		// console.log(`🎲 Test:naked '${naked(target2)}' is found in '${naked(test2)}' | ${test}`);
		return true;
	} else if (
		removeRepeats(target2).length >= magicLength &&
		removeRepeats(test2).includes(removeRepeats(target2))
	) {
		// console.log(`🎲 Test:removeRepeats '${removeRepeats(target2)}' is found in '${removeRepeats(test2)}' | ${test}`);
		return true;
	} else if (
		removeDiacritics(target2).length >= magicLength &&
		removeDiacritics(test2).includes(removeDiacritics(target2))
	) {
		// console.log(`🎲 Test:removeDiacritics '${removeDiacritics(target2)}' is found in '${removeDiacritics(test2)}' | ${test}`);
		return true;
	} else if (target2.length >= Math.ceil(magicLength * 1.5) && test2.includes(target2)) {
		// console.log(`🎲 Test:plain '${target2}' is found in '${test2}' | ${test}`);
		return true;
	}
	// if (strictEqual(target, movieTitle) || strictEqual(target, tvTitle)) console.log(`🎲 Test:strictEqual '${target}' is found in '${movieTitle}' or '${tvTitle}' | ${test}`);
	return strictEqual(target, movieTitle) || strictEqual(target, tvTitle);
}

export function matchesTitle(target: string, years: string[], test: string): boolean {
	target = target.toLowerCase();
	test = test.toLowerCase();

	const splits = target.split(/\W+/).filter((e) => e);
	const containsYear = hasYear(test, years);
	if (flexEq(test, target, years)) {
		const sequenceCheck = countTestTermsInTarget(test, splits.join(' '), true);
		// console.log(`🎲 FlexEq '${target}' is found in '${test}'`, sequenceCheck);
		return containsYear || sequenceCheck >= 0;
	}

	const totalTerms = splits.length;
	if (totalTerms === 0 || (totalTerms <= 2 && !containsYear)) {
		// console.log(`👻 Too few terms in '${target}'`);
		return false;
	}

	const keyTerms: string[] = splits.filter(
		(s) => (s.length > 1 && !dictionary.has(s)) || s.length > 5
	);
	keyTerms.push(...target.split(/\w+/).filter((e) => e.length > 2));
	const keySet = new Set(keyTerms);
	const commonTerms = splits.filter((s) => !keySet.has(s));

	let hasYearScore = totalTerms * 1.5;
	let totalScore = keyTerms.length * 2 + commonTerms.length + hasYearScore;

	if (keyTerms.length === 0 && totalTerms <= 2 && !containsYear) {
		// console.log(`👻 No identifiable terms in '${target}'`);
		return false;
	}

	let foundKeyTerms = countTestTermsInTarget(test, keyTerms.join(' '));
	let foundCommonTerms = countTestTermsInTarget(test, commonTerms.join(' '));
	const score = foundKeyTerms * 2 + foundCommonTerms + (containsYear ? hasYearScore : 0);
	if (Math.floor(score / 0.85) >= totalScore) {
		// console.log(`🎯 Scored ${score} out of ${totalScore} for target '${target}' in '${test}' (+${foundKeyTerms*2} +${foundCommonTerms} +${containsYear?hasYearScore:0})`, keyTerms, commonTerms);
		return true;
	}

	// console.log(`👻 '${target}' is not '${test}' !!!`)
	return false;
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
	const words = testTitle
		.toLowerCase()
		.split(/\W+/)
		.filter((word: string) => word.length > 3);
	const hasBannedWords = words.some((word: string) => {
		if (!targetTitle.includes(word) && bannedWordSet.has(word))
			console.log('💀 Found banned word in title:', word, ' <> ', testTitle);
		return !targetTitle.includes(word) && bannedWordSet.has(word);
	});

	let titleWithoutSymbols = testTitle.toLowerCase().split(/\W+/).join(' ');
	const hasBannedCompoundWords = bannedWordSet2.some((compoundWord: string) => {
		if (!targetTitle.includes(compoundWord) && titleWithoutSymbols.includes(compoundWord))
			console.log('💀 Found banned compound word in title:', compoundWord, ' <> ', testTitle);
		return !targetTitle.includes(compoundWord) && titleWithoutSymbols.includes(compoundWord);
	});

	return !hasBannedWords && !hasBannedCompoundWords;
}

export function meetsTitleConditions(
	targetTitle: string,
	years: string[],
	testTitle: string
): boolean {
	return matchesTitle(targetTitle, years, testTitle) && hasNoBannedTerms(targetTitle, testTitle);
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
		`🏹 Movie: ${cleanTitle} Y:${
			mdbData?.year ?? '????'
		} (${imdbId}) (uncommon terms: ${countUncommonWords(tmdbData.title)})`
	);
	const year: string =
		mdbData?.year ??
		mdbData?.released?.substring(0, 4) ??
		tmdbData.release_date?.substring(0, 4);
	const airDate: string = mdbData?.released ?? tmdbData.release_date ?? '2000-01-01';
	let originalTitle: string | undefined, cleanedTitle: string | undefined;

	const processedTitle = tmdbData.title
		.split(' ')
		.map((word: string) => word.replace(/[\W]+/g, ''))
		.join(' ')
		.trim()
		.toLowerCase();

	if (tmdbData.original_title && tmdbData.original_title !== tmdbData.title) {
		originalTitle = tmdbData.original_title.toLowerCase();
		console.log(
			'🎯 Found original title:',
			originalTitle,
			`(uncommon: ${countUncommonWords(originalTitle!)})`
		);
		for (let rating of mdbData?.ratings ?? []) {
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
	for (let rating of mdbData?.ratings ?? []) {
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
	mdbData?.seasons?.length
		? mdbData?.seasons
		: [{ name: 'Season 1', season_number: 1, episode_count: 0 }];

export function grabTvMetadata(imdbId: string, tmdbData: any, mdbData: any) {
	const cleanTitle = cleanSearchQuery(tmdbData.name);
	const liteCleantitle = liteCleanSearchQuery(tmdbData.name);
	console.log(
		`🏏 ${getSeasons(mdbData).length} season(s) of tv show: ${tmdbData.name} (${imdbId})...`
	);
	const year: string =
		mdbData?.year ??
		mdbData?.released?.substring(0, 4) ??
		tmdbData.release_date?.substring(0, 4);
	let originalTitle: string | undefined, cleanedTitle: string | undefined;

	const processedTitle = tmdbData.name
		.split(' ')
		.map((word: string) => word.replace(/[\W]+/g, ''))
		.join(' ')
		.trim()
		.toLowerCase();

	if (tmdbData.original_name && tmdbData.original_name !== tmdbData.name) {
		originalTitle = tmdbData.original_name.toLowerCase();
		console.log(
			'🎯 Found original title:',
			originalTitle,
			`(uncommon: ${countUncommonWords(originalTitle!)})`
		);
		for (let rating of mdbData?.ratings ?? []) {
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
	for (let rating of mdbData?.ratings ?? []) {
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

export function filterByMovieConditions(items: ScrapeSearchResult[]) {
	return (
		items
			// not a tv show
			.filter(
				(result) => !/s\d\d?e\d\d?/i.test(result.title) && !/\bs\d\d?\b/i.test(result.title)
			)
			// check for file size
			.filter((result) => result.fileSize < 200000 && result.fileSize > 500)
	);
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
	const years = [firstYear, seasonYear].filter((y) => y !== undefined) as string[];
	return (
		items
			// check for file size
			.filter((result) => result.fileSize > 100)
			// check for year
			.filter((result) => {
				const yearsFromTitle = grabYears(title);
				const hasYearOnFilename =
					grabYears(result.title).filter((y) => !yearsFromTitle.includes(y)).length > 0;
				return (hasYearOnFilename && hasYear(result.title, years)) || !hasYearOnFilename;
			})
			// check for season number or season name
			.filter((result) => {
				// drop 3xRus or 1xEng or AC3
				let regex =
					/\b(\d)x([a-z]+)\b|\bac3\b|\b5\.1|\bmp4|\bav1|\br[1-6]|\bdvd\-?\d|\bp2p|\bbd\d+/gi;
				let resultTitle = result.title.replace(regex, '');

				if (resultTitle.match(/\bs\d\de?/i)) {
					const season = parseInt(resultTitle.match(/s(\d\d)e?/i)![1]);
					return season === seasonNumber || season === seasonCode;
				}

				resultTitle = resultTitle.replace(/e\d\d[^\d].*/g, '');
				const seasonNums = grabPossibleSeasonNums(resultTitle);

				if (
					seasonName &&
					seasonCode &&
					flexEq(naked(seasonName), naked(result.title), years) &&
					seasonNums.filter((num) => num === seasonCode).length > 0
				) {
					return true;
				}
				if (seasonName && seasonName !== title && flexEq(resultTitle, seasonName, years)) {
					return true;
				}
				if (
					seasonNums.filter((num) => num === seasonNumber || num === seasonCode).length >
					0
				) {
					return true;
				}
				// it can contain no numbers if it's still season 1 (or only season 1)
				// console.log('🎯 Season number 1:', result.title, seasons);
				return seasonNumber === 1 && grabPossibleSeasonNums(resultTitle).length === 0;
			})
	);
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
