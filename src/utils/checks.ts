import fs from 'fs';

let wordSet: Set<string>;
try {
	let data = fs.readFileSync('./wordlist.txt', 'utf8');
	wordSet = new Set(data.toLowerCase().split('\n'));
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

function matchesTitle(targetTitle: string, year: string, testTitle: string) {
	const result = /^(?<firstWord>\w+)/i.exec(targetTitle);
	if (result && result.groups) {
		if (!new RegExp(`\\b${result.groups.firstWord}`, 'i').test(testTitle)) {
			return false;
		}
	}
	let nakedTitle = naked(targetTitle);
	let nakedTest = naked(testTitle);
	if (nakedTitle.length < 3) {
		// just drop the space
		nakedTitle = targetTitle.replace(/\s+/g, '');
		nakedTest = testTitle.replace(/\s+/g, '');
		// nakedTitle += year;
	}
	if (!countUncommonWords(nakedTitle)) {
		nakedTitle += year;
	}
	return nakedTest.includes(nakedTitle);
}

function includesMustHaveTerms(mustHaveTerms: (string | RegExp)[], testTitle: string) {
	let actualCount = 0;
	for (let i = 0; i < mustHaveTerms.length; i++) {
		let term = mustHaveTerms[i];
		const bufTitle = testTitle.replace(term, '');
		if (bufTitle !== testTitle) {
			actualCount++;
		}
		testTitle = bufTitle;
	}
	return actualCount >= mustHaveTerms.length;
}

function hasNoBannedTerms(targetTitle: string, testTitle: string): boolean {
	let processedTitle = testTitle
		.toLowerCase()
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
	mustHaveTerms: (string | RegExp)[],
	testTitle: string
): boolean {
	return (
		matchesTitle(targetTitle, year, testTitle) &&
		includesMustHaveTerms(mustHaveTerms, testTitle) &&
		hasNoBannedTerms(targetTitle, testTitle)
	);
}

export function countUncommonWords(title: string) {
	let processedTitle = title
		.split(/\s+/)
		.map((word: string) =>
			word.toLowerCase().replace(/'s/g, '').replace(/\s&\s/g, ' and ').replace(/[\W]+/g, '')
		)
		.filter((word: string) => word.length > 3);
	return processedTitle.filter((word: string) => !wordSet.has(word)).length;
}
