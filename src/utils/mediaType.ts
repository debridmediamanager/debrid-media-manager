export const getMediaType = (filename: string): 'tv' | 'movie' => {
	return /s\d\d|season[\.\s]?\d/i.test(filename) ? 'tv' : 'movie';
};
