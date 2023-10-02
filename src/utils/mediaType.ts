export const getMediaType = (filename: string): 'tv' | 'movie' => {
	return /seasons?.\d/i.test(filename) || /s\d\d/i.test(filename) || /\btv/i.test(filename)
		? 'tv'
		: 'movie';
};
