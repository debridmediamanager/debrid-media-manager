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

export function hasYear(test: string, year: string) {
	const intYear = parseInt(year);
	return (
		test.includes(year) || test.includes(`${intYear + 1}`) || test.includes(`${intYear - 1}`)
	);
}

function removeDiacritics(str: string) {
	return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function removeRepeats(str: string) {
	return str.replace(/(.)\1+/g, '$1');
}

function flexIn(test: string, target: string) {
	return (
		test.includes(target) ||
		removeRepeats(test).includes(removeRepeats(target)) ||
		removeDiacritics(test).includes(removeDiacritics(target))
	);
}

export function matchesTitle(target: string, year: string, test: string) {
	target = target.toLowerCase();
	test = test.toLowerCase();
	const containsYear = hasYear(test, year);

	// if title doesn't contain any spaces, then we can do a simple match
	if (!target.match(/\s/)) {
		// if title is common, also check for year
		if (countUncommonWords(target) === 0) {
			if (flexIn(test, target) && containsYear) {
				return true;
			}
		}
		// if title is uncommon single word, remove all non-alphanumeric characters
		// note: may contain symbols, or just be only symbols
		let targetTitle2 = naked(target);
		let testTitle2 = naked(test);
		const magicLength = 5;
		if (targetTitle2.length > magicLength && testTitle2.includes(targetTitle2)) {
			return true;
		} else if (flexIn(test, target) && containsYear) {
			return true;
		}
	}

	// if title is alphanumeric with spaces, then we can do a simple match
	if (target.match(/^[a-z0-9\s]+$/) !== null) {
		// remove spaces
		let targetTitle2 = target.replace(/\s/g, '');
		let testTitle2 = test.replace(/\s/g, '');
		const magicLength = 9;
		if (targetTitle2.length > magicLength && testTitle2.includes(targetTitle2)) {
			return true;
		} else if (flexIn(testTitle2, targetTitle2) && containsYear) {
			return true;
		}
	}
	// if title is alphanumeric with symbols and spaces
	let targetTitle2 = target.replace(/\s/g, '');
	let testTitle2 = test.replace(/\s/g, '');
	let targetTitle3 = naked(targetTitle2);
	let testTitle3 = naked(testTitle2);
	const magicLength = 9;
	if (targetTitle3.length > magicLength && testTitle3.includes(targetTitle3)) {
		return true;
	} else if (targetTitle2.length > magicLength && testTitle2.includes(targetTitle2)) {
		return true;
	} else if (flexIn(testTitle2, targetTitle2) && containsYear) {
		return true;
	}

	// last chance
	const splits = target.split(/\s+/);
	if (splits.length > 4) {
		let target2 = target;
		const actual = splits.filter((term) => {
			let newTitle = target2.replace(term, '');
			if (newTitle !== target2) {
				target2 = newTitle;
				return true;
			}

			newTitle = target2.replace(removeDiacritics(term), '');
			if (newTitle !== target2) {
				target2 = newTitle;
				return true;
			}

			newTitle = target2.replace(removeRepeats(term), '');
			if (newTitle !== target2) {
				target2 = newTitle;
				return true;
			}
			return false;
		}).length;
		if (actual + 1 >= splits.length) {
			return true;
		}
	}
	const mustHaveTerms: string[] = splits.filter((word) => !dictionary.has(word));
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

export function movieHasNoBannedTerms(targetTitle: string, testTitle: string): boolean {
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
	return (
		matchesTitle(targetTitle, year, testTitle) && movieHasNoBannedTerms(targetTitle, testTitle)
	);
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

export function grabAllMetadata(imdbId: string, tmdbData: any, mdbData: any) {
	const cleanTitle = cleanSearchQuery(tmdbData.title);
	const liteCleantitle = liteCleanSearchQuery(tmdbData.title);
	console.log(
		`🏹 Cleaning movie: ${cleanTitle} Y${
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
