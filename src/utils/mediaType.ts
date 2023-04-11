export const getMediaType = (filename: string): 'tv' | 'movie' => {
	return /\bs\d\d|season[\.\s]?\d/i.test(filename) ? 'tv' : 'movie';
};
