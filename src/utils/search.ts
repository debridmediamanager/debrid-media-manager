export const cleanSearchQuery = (search: string): string => {
	return search
		.split(/[\s\(\)\[\]\{\}\+\\\^\|·\?,\/:;'"!]/) // split the search query into an array of elements
		.filter((e) => e !== '') // filter out any empty elements
		.map((e) => e.toLowerCase()) // convert each element to lowercase
		.join(' ') // join the remaining elements with a single space
		.replace(/[áàäâ]/g, 'a') // replace certain characters with their equivalent
		.replace(/[éèëê]/g, 'e')
		.replace(/[íìïî]/g, 'i')
		.replace(/[óòöô]/g, 'o')
		.replace(/[úùüû]/g, 'u')
		.replaceAll(':', ' ')
		.replace(/\s+/g, ' ') // replace multiple spaces with a single space
		.trim();
};
