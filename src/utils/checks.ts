import { ScrapeSearchResult } from '@/services/mediasearch';
import { filenameParse } from '@ctrl/video-filename-parser';
import fs from 'fs';
import ptt from 'parse-torrent-title';
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
	return title
		.toLowerCase()
		.replace(
			/[^a-z0-9\x00-\x7F\u0100-\u017F\u0180-\u024F\u0370-\u03FF\u0400-\u04FF\u0500-\u052F\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u0780-\u07BF\u0800-\u083F\u0840-\u085F\u08A0-\u08FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0D80-\u0DFF\u0E00-\u0E7F\u0E80-\u0EFF\u0F00-\u0FFF\u1000-\u109F\u10A0-\u10FF\u1100-\u11FF\u1200-\u137F\u13A0-\u13FF\u1400-\u167F\u1680-\u169F\u16A0-\u16FF\u1700-\u171F\u1720-\u173F\u1740-\u175F\u1760-\u177F\u1780-\u17FF\u1800-\u18AF\u1E00-\u1EFF\u1F00-\u1FFF\u2000-\u206F\u2E00-\u2E7F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF'!"#$%&()*+,\-.\/:;<=>?@\[\]^_`{|}~\s]/gi,
			''
		);
}

export function grabYears(str: string): string[] {
	return (str.match(/\d{4}/g) ?? []).filter(
		(n) => parseInt(n, 10) > 1900 && parseInt(n, 10) <= new Date().getFullYear()
	);
}

export function grabPossibleSeasonNums(str: string): number[] {
	return (str.match(/\d+/g) ?? []).map((n) => parseInt(n, 10)).filter((n) => n > 0 && n <= 100);
}

export function filenameHasGivenYear(test: string, years: string[]) {
	return years.some(
		(year) =>
			test.includes(year) ||
			test.includes(`${parseInt(year, 10) + 1}`) ||
			test.includes(`${parseInt(year, 10) - 1}`)
	);
}

function removeDiacritics(str: string) {
	return str.normalize('NFD').replace(/[\u0300-\u036f]/gi, '');
}

function removeRepeats(str: string) {
	return str.replace(/(.)\1+/gi, '$1');
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
	title1 = title1.replace(/\s+/gi, '');
	title2 = title2.replace(/\s+/gi, '');
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
		if (first) prefix = '\\W';
		let suffix = '';
		if (last) suffix = '\\W';
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

function flexEq(test: string, target: string, targetYears: string[]) {
	const targetNoSpc = target.replace(/\s+/gi, '');
	const testNoSpc = test.replace(/\s+/gi, '');

	// console.log(`🎲 '${target2}' '${test2}' '${detectNonEnglishCharacters(target2)}'`);

	let magicLength = 5; // Math.ceil(magicLength*1.5) = 8
	if (filenameHasGivenYear(test, targetYears)) magicLength = 3; // Math.ceil(magicLength*1.5) = 5

	const shouldCheckNaked = naked(targetNoSpc).length >= magicLength;
	const shouldCheckRepeats = removeRepeats(targetNoSpc).length >= magicLength;
	const shouldCheckDiacritics = removeDiacritics(targetNoSpc).length >= magicLength;
	if (shouldCheckNaked && naked(testNoSpc).includes(naked(targetNoSpc))) {
		// console.log(
		// 	`🎲 Test:naked '${naked(target2)}' is found in '${naked(test2)}' | ${target} ${test}`
		// );
		return true;
	} else if (
		shouldCheckRepeats &&
		removeRepeats(testNoSpc).includes(removeRepeats(targetNoSpc))
	) {
		// console.log(
		// 	`🎲 Test:removeRepeats '${removeRepeats(target2)}' is found in '${removeRepeats(
		// 		test2
		// 	)}' | ${test}`
		// );
		return true;
	} else if (
		shouldCheckDiacritics &&
		removeDiacritics(testNoSpc).includes(removeDiacritics(targetNoSpc))
	) {
		// console.log(
		// 	`🎲 Test:removeDiacritics '${removeDiacritics(
		// 		target2
		// 	)}' is found in '${removeDiacritics(test2)}' | ${test}`
		// );
		return true;
	} else if (
		targetNoSpc.length >= Math.ceil(magicLength * 1.5) &&
		testNoSpc.includes(targetNoSpc)
	) {
		// console.log(`🎲 Test:plain '${target2}' is found in '${test2}' | ${test}`);
		return true;
	}
	// if (strictEqual(target, movieTitle) || strictEqual(target, tvTitle)) console.log(`🎲 Test:strictEqual '${target}' is found in '${movieTitle}' or '${tvTitle}' | ${test}`);
	try {
		// check if test has 4 digits
		if (test.match(/\d{4}/) && !target.match(/\d{4}/)) {
			// remove year from test
			test = test.replace(/\d{4}/, '');
		}
		const movieTitle = filenameParse(test).title.toLowerCase();
		const tvTitle = filenameParse(test, true).title.toLowerCase();
		return strictEqual(target, movieTitle) || strictEqual(target, tvTitle);
	} catch (e) {
		return false;
	}
}

export function matchesTitle(target: string, targetYears: string[], test: string): boolean {
	target = target.toLowerCase();
	test = test.toLowerCase();

	const targetTerms = target.split(/\W+/).filter((e) => e);
	const containsYear = filenameHasGivenYear(test, targetYears);
	if (flexEq(test, target, targetYears)) {
		const sequenceCheck = countTestTermsInTarget(test, targetTerms.join(' '), true);
		// console.log(`🎲 FlexEq '${target}' is found in '${test}'`, sequenceCheck);
		if (!(containsYear || sequenceCheck >= 0)) {
			console.log(`👻 FlexEq '${target}' is not '${test}' !!!`);
		}
		return containsYear || sequenceCheck >= 0;
	}

	const targetTermsCount = targetTerms.length;
	if (targetTermsCount === 0 || (targetTermsCount <= 2 && !containsYear)) {
		console.log(`👻 Too few terms in '${target}'`);
		return false;
	}

	const keyTerms: string[] = targetTerms.filter(
		(s) => (s.length > 1 && !dictionary.has(s)) || s.length > 5
	);
	keyTerms.push(...target.split(/\w+/).filter((e) => e.length > 2));
	const keySet = new Set(keyTerms);
	const commonTerms = targetTerms.filter((s) => !keySet.has(s));

	let hasYearScore = targetTermsCount * 0.4;
	let totalScore = keyTerms.length * 2 + commonTerms.length;

	if (keyTerms.length === 0 && targetTermsCount <= 2 && !containsYear) {
		console.log(`👻 No identifiable terms in '${target}'`);
		return false;
	}

	let foundKeyTerms = keyTerms.filter((term) => test.includes(term)).length;
	let foundCommonTerms = commonTerms.filter((term) => test.includes(term)).length;
	const score = foundKeyTerms * 2 + foundCommonTerms + (containsYear ? hasYearScore : 0);
	if (Math.floor(score / 0.8) >= totalScore) {
		// console.log(`🎯 Scored ${score} out of ${totalScore} for target '${target}' in '${test}' (+${foundKeyTerms*2} +${foundCommonTerms} +${containsYear?hasYearScore:0})`, keyTerms, commonTerms);
		return true;
	}

	console.log(
		`👻 Found key terms ${foundKeyTerms}, common terms ${foundCommonTerms} in '${test}' (score: ${score}/${totalScore})`
	);
	return false;
}

// Helper function to escape regex special characters in a string
function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

// Helper function to convert Roman numerals to numbers
function romanToNumber(roman: string): number {
	const romanNumerals: { [key: string]: number } = {
		I: 1,
		V: 5,
		X: 10,
		L: 50,
		C: 100,
		D: 500,
		M: 1000,
	};
	let num = 0;
	let prevValue = 0;
	for (const char of roman.toUpperCase()) {
		const value = romanNumerals[char];
		if (!value) return NaN; // Invalid Roman numeral character
		if (value <= prevValue) {
			num += value;
		} else {
			num += value - 2 * prevValue;
		}
		prevValue = value;
	}
	return num;
}

export function matchesYear(test: string, targetYears: number[]): boolean {
	// Improved regex with word boundaries for precise matching
	const yearRegex = /\b(?:189\d|19\d\d|20[012][0-5])\b/g;

	// Extract years from the test string
	const yearsFromTest = [...test.matchAll(yearRegex)]
		.map((m) => parseInt(m[0], 10))
		.filter((y) => y !== 1920); // Exclude the year 1920 if needed

	if (
		yearsFromTest.length > 0 &&
		targetYears.length > 0 &&
		!yearsFromTest.some((testYear) => {
			return (
				targetYears.includes(testYear) ||
				targetYears.includes(testYear - 1) ||
				targetYears.includes(testYear + 1)
			);
		})
	) {
		return false;
	}
	return true;
}

export function hasNoBannedTerms(targetTitle: string, testTitle: string): boolean {
	const words = testTitle
		.toLowerCase()
		.split(/\W+/)
		.filter((word: string) => word.length >= 3);
	const hasBannedWords = words.some((word: string) => {
		// if (!targetTitle.includes(word) && bannedWordSet.has(word))
		// 	console.log('💀 Found banned word in title:', word, ' <> ', testTitle);
		return !targetTitle.includes(word) && bannedWordSet.has(word);
	});

	let titleWithoutSymbols = testTitle.toLowerCase().split(/\W+/).join(' ');
	const hasBannedCompoundWords = bannedWordSet2.some((compoundWord: string) => {
		// if (!targetTitle.includes(compoundWord) && titleWithoutSymbols.includes(compoundWord))
		// 	console.log('💀 Found banned compound word in title:', compoundWord, ' <> ', testTitle);
		return !targetTitle.includes(compoundWord) && titleWithoutSymbols.includes(compoundWord);
	});

	return !hasBannedWords && !hasBannedCompoundWords;
}

export function meetsTitleConditions(
	targetTitle: string,
	years: string[],
	testTitle: string
): boolean {
	testTitle = testTitle.replace(/^www\.\w+\.(com|net|org)\s*-\s*/i, '');
	testTitle = testTitle.replace(/^\[[^\]]+\]\s*/i, '');
	const information = ptt.parse(testTitle);
	const ratio =
		1 -
		levenshtein(targetTitle, information.title) /
			(targetTitle.length + information.title.length);
	if (ratio >= 0.85) return true;

	const targetTitleNoSpecial = targetTitle.replace(/[^a-z0-9\s]/gi, '');
	const testTitleNoSpecial = information.title.replace(/[^a-z0-9\s]/gi, '');
	if (targetTitleNoSpecial.includes(testTitleNoSpecial)) return true;

	if (information.group) {
		testTitle = testTitle.replace(information.group, '');
	}
	const yearOk = matchesYear(
		testTitle,
		years.map((year) => parseInt(year, 10))
	);
	return matchesTitle(targetTitle, years, testTitle) && yearOk;
}

export function countUncommonWords(title: string) {
	let processedTitle = title
		.split(/\s+/)
		.map((word: string) =>
			word.toLowerCase().replace(/'s/gi, '').replace(/\s&\s/gi, '').replace(/[\W]+/gi, '')
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
		tmdbData.release_date?.substring(0, 4) ??
		'Unknown';
	const airDate: string = mdbData?.released ?? tmdbData.release_date ?? '2000-01-01';
	let originalTitle: string | undefined, cleanedTitle: string | undefined;

	const processedTitle = tmdbData.title
		.split(' ')
		.map((word: string) => word.replace(/[\W]+/gi, ''))
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
					.map((word: string) => word.replace(/[\W]+/gi, ''))
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
				.map((word: string) => word.replace(/[\W]+/gi, ''))
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
		tmdbData.release_date?.substring(0, 4) ??
		'Unknown';
	let originalTitle: string | undefined, cleanedTitle: string | undefined;

	const processedTitle = tmdbData.name
		.split(' ')
		.map((word: string) => word.replace(/[\W]+/gi, ''))
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
					.map((word: string) => word.replace(/[\W]+/gi, ''))
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
				.map((word: string) => word.replace(/[\W]+/gi, ''))
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
				ret.push(title.replace(/&/gi, ' and '));
			}
			if (title.match(/[a-z\s]\+/i)) {
				ret.push(title.replace(/\+/gi, ' and '));
			}
			if (title.match(/[a-z\s]@/i)) {
				ret.push(title.replace(/@/gi, ' at '));
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
				(result) => !/s\d\d?e\d\d?/i.test(result.title) && !/\Ws\d\d?\W/i.test(result.title)
			)
			// check for file size
			.filter((result) => result.fileSize < 250000 && result.fileSize > 500)
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
				return (
					(hasYearOnFilename && filenameHasGivenYear(result.title, years)) ||
					!hasYearOnFilename
				);
			})
			// check for season number or season name
			.filter((result) => {
				// drop 3xRus or 1xEng or AC3
				let regex =
					/\W(\d)x([a-z]+)\W|\Wac3\W|\W5\.1|\Wmp4|\Wav1|\Wr[1-6]|\Wdvd\-?\d|\Wp2p|\Wbd\d+/gi;
				let resultTitle = result.title.replace(regex, '');

				if (resultTitle.match(/\Ws\d\de?/i)) {
					const season = parseInt(resultTitle.match(/s(\d\d)e?/i)![1]);
					return season === seasonNumber || season === seasonCode;
				}

				resultTitle = resultTitle.replace(/e\d\d[^\d].*/gi, '');
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

export const getSeasonYear = (season: any): string => season.air_date?.substring(0, 4);

export function levenshtein(s: string, t: string) {
	if (s === t) {
		return 0;
	}
	var n = s.length,
		m = t.length;
	if (n === 0 || m === 0) {
		return n + m;
	}
	var x = 0,
		y,
		a,
		b,
		c,
		d,
		g,
		h,
		k;
	var p = new Array(n);
	for (y = 0; y < n; ) {
		p[y] = ++y;
	}

	for (; x + 3 < m; x += 4) {
		var e1 = t.charCodeAt(x);
		var e2 = t.charCodeAt(x + 1);
		var e3 = t.charCodeAt(x + 2);
		var e4 = t.charCodeAt(x + 3);
		c = x;
		b = x + 1;
		d = x + 2;
		g = x + 3;
		h = x + 4;
		for (y = 0; y < n; y++) {
			k = s.charCodeAt(y);
			a = p[y];
			if (a < c || b < c) {
				c = a > b ? b + 1 : a + 1;
			} else {
				if (e1 !== k) {
					c++;
				}
			}

			if (c < b || d < b) {
				b = c > d ? d + 1 : c + 1;
			} else {
				if (e2 !== k) {
					b++;
				}
			}

			if (b < d || g < d) {
				d = b > g ? g + 1 : b + 1;
			} else {
				if (e3 !== k) {
					d++;
				}
			}

			if (d < g || h < g) {
				g = d > h ? h + 1 : d + 1;
			} else {
				if (e4 !== k) {
					g++;
				}
			}
			p[y] = h = g;
			g = d;
			d = b;
			b = c;
			c = a;
		}
	}

	for (; x < m; ) {
		var e = t.charCodeAt(x);
		c = x;
		d = ++x;
		for (y = 0; y < n; y++) {
			a = p[y];
			if (a < c || d < c) {
				d = a > d ? d + 1 : a + 1;
			} else {
				if (e !== s.charCodeAt(y)) {
					d = c + 1;
				} else {
					d = c;
				}
			}
			p[y] = d;
			c = a;
		}
		h = d;
	}

	return h;
}
