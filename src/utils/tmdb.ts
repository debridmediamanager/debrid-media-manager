export type TmdbResponse = {
	movie_results: {
		title: string;
		overview: string;
		release_date: string;
		poster_path: string;
	}[];
	tv_results: {
		name: string;
		overview: string;
		first_air_date: string;
		poster_path: string;
	}[];
};

/**
 * TMDB returns art as a bare path fragment ("/abc.jpg"); the caller chooses the
 * rendered width. image.tmdb.org carries no credential, so the built URL is safe
 * to hand to a browser, and the host is already in next.config.js remotePatterns.
 */
export const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';

export type TmdbImageSize = 'w300' | 'w500' | 'w780' | 'w1280' | 'original';

/**
 * A displayable TMDB image URL, or null when TMDB has no art for that field.
 * Returns null rather than a half-built URL so it can sit in a `??` chain
 * alongside the other metadata sources.
 */
export function tmdbImageUrl(path: string | null | undefined, size: TmdbImageSize): string | null {
	if (typeof path !== 'string') return null;
	const trimmed = path.trim();
	if (!trimmed) return null;
	return `${TMDB_IMAGE_BASE_URL}/${size}${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}`;
}
