export const stopWords = [
	'the',
	'and',
	'be',
	'to',
	'of',
	'a',
	'in',
	'i',
	'it',
	'on',
	'he',
	'as',
	'do',
	'at',
	'by',
	'we',
	'or',
	'an',
	'my',
	'so',
	'up',
	'if',
	'me',
];

export const cleanSearchQuery = (search: string): string => {
	return search
		.split(/[\s\=:\?\.\-\(\)\/]/) // split the search query into an array of elements
		.filter((e) => e !== '') // filter out any empty elements
		.map((e) => e.toLowerCase()) // convert each element to lowercase
		.filter((term) => !stopWords.includes(term)) // remove any stop words from an array
		.join(' ') // join the remaining elements with a single space
		.replace(/[áàäâ]/g, 'a') // replace certain characters with their equivalent
		.replace(/[éèëê]/g, 'e')
		.replace(/[íìïî]/g, 'i')
		.replace(/[óòöô]/g, 'o')
		.replace(/[úùüû]/g, 'u')
		.replace(/[ç]/g, 'c')
		.replace(/[ñ]/g, 'n')
		.replace(/[ş]/g, 's')
		.replace(/[ğ]/g, 'g')
		.replace(/\s+/g, ' ') // replace multiple spaces with a single space
		.trim();
};

export const getLibraryTypes = (libraryType: string): string[] => {
	switch (libraryType) {
		case '1080pOr2160p':
			return ['1080p', '2160p', ''];
		case '2160p':
			return ['2160p', ''];
		default:
			return ['1080p', '2160p', ''];
	}
};
