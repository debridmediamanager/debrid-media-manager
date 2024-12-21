export const formatSize = (bytes: number): { size: number; unit: string } => {
	const isGB = bytes >= 1024 ** 3;
	return {
		size: bytes / (isGB ? 1024 ** 3 : 1024 ** 2),
		unit: isGB ? 'GB' : 'MB',
	};
};

export const getEpisodeInfo = (
	path: string,
	mediaType: 'movie' | 'tv' = 'tv'
): { isTvEpisode: boolean } => {
	let epRegex = /S(\d+)\s?E(\d+)/i;
	let isTvEpisode = Boolean(path.match(epRegex));

	if (mediaType === 'tv' && !isTvEpisode) {
		epRegex = /[^\d](\d{1,2})x(\d{1,2})[^\d]/i;
		isTvEpisode = Boolean(path.match(epRegex));
	}

	return { isTvEpisode };
};
