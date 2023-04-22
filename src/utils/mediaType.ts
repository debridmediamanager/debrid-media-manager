export const getMediaType = (filename: string): 'tv' | 'movie' => {
	return /[\(\.\s)]s\d\d[\be]?|[\(\.\s)]season[\.\s]?\d[\d]?[\be]?/i.test(filename)
		? 'tv'
		: 'movie';
};
