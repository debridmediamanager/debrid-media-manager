export function getStremioDetailUrl(
	imdbId: string,
	options?: {
		season?: number | string;
		episode?: number | string;
	}
): string {
	const season = options?.season;
	const episode = options?.episode;

	if (season !== undefined && episode !== undefined && season !== '' && episode !== '') {
		return `stremio:///detail/series/${imdbId}/${imdbId}:${season}:${episode}`;
	}

	return `stremio:///detail/movie/${imdbId}/${imdbId}`;
}
