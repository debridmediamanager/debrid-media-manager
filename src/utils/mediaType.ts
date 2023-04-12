export const getMediaType = (filename: string): 'tv' | 'movie' => {
	return /[\(\.\s)]s\d\d|[\(\.\s)]season[\.\s]?\d/i.test(filename) ? 'tv' : 'movie';
};
