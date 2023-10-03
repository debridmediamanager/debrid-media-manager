import fs from 'fs';

let wordSet: Set<string>;
try {
	let data = fs.readFileSync('./bannedwordlist.txt', 'utf8');
	wordSet = new Set(data.toLowerCase().split('\n'));
} catch (err) {
	console.error('error loading banned wordlist', err);
}

export function naked(title: string): string {
	return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function matchesTitle(targetTitle: string, testTitle: string) {
	const result = /^(?<firstWord>\w+)/i.exec(targetTitle);
	if (result && result.groups) {
		if (!new RegExp(`\\b${result.groups.firstWord}`, 'i').test(testTitle)) {
			return false;
		}
	}
	const nakedTitle = naked(targetTitle);
	const nakedTest = naked(testTitle);
	return nakedTest.includes(nakedTitle);
}

export function includesMustHaveTerms(mustHaveTerms: (string | RegExp)[], testTitle: string) {
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

export function hasNoBannedTerms(targetTitle: string, testTitle: string): boolean {
	let processedTitle = testTitle
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word: string) => word.length >= 3);
	return (
		processedTitle.filter((word: string) => !targetTitle.includes(word) && wordSet.has(word))
			.length === 0
	);
}

export function meetsTitleConditions(
	targetTitle: string,
	mustHaveTerms: (string | RegExp)[],
	testTitle: string
): boolean {
	return (
		matchesTitle(targetTitle, testTitle) &&
		includesMustHaveTerms(mustHaveTerms, testTitle) &&
		hasNoBannedTerms(targetTitle, testTitle)
	);
}
