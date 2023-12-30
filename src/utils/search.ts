export const cleanSearchQuery = (search: string): string => {
	return search
		.split(/[\s\(\)\[\]\{\}\+\\\^\|·\?,\/:;"!]/) // split the search query into an array of elements
		.filter((e) => e !== '') // filter out any empty elements
		.map((e) => e.toLowerCase()) // convert each element to lowercase
		.join(' ') // join the remaining elements with a single space
		.replace(/[áàäâ]/gi, 'a') // replace certain characters with their equivalent
		.replace(/[éèëê]/gi, 'e')
		.replace(/[íìïî]/gi, 'i')
		.replace(/[óòöô]/gi, 'o')
		.replace(/[úùüû]/gi, 'u')
		.replaceAll(':', ' ')
		.replace(/\s+/gi, ' ') // replace multiple spaces with a single space
		.trim();
};

export const liteCleanSearchQuery = (search: string): string => {
	return search
		.split(/[\s:;"',]/) // split the search query into an array of elements
		.filter((e) => e !== '') // filter out any empty elements
		.map((e) => e.toLowerCase()) // convert each element to lowercase
		.join(' ')
		.trim();
};

export const tokenizeString = (search: string): string[] => {
	return search
		.split(/[\s\(\)\[\]\{\}\+\\\^\|·\?,\/:;"!]/) // split the search query into an array of elements
		.filter((e) => e !== '') // filter out any empty elements
		.map((e) => e.toLowerCase());
};
