import axios, { AxiosRequestConfig } from 'axios';
import getConfig from 'next/config';
import { getMdblistCacheService } from './database/mdblistCache';

export class MetadataCacheService {
	private cache = getMdblistCacheService();

	private get runtimeConfig() {
		const config = getConfig();
		return config?.publicRuntimeConfig || {};
	}

	// Cache durations in milliseconds
	private readonly CACHE_DURATIONS = {
		// Permanent cache for static content
		PERMANENT: 0,
		// Short cache for dynamic content
		SEARCH: 3600000, // 1 hour
		TRENDING: 3600000, // 1 hour
		POPULAR: 21600000, // 6 hours
		TOP_LISTS: 86400000, // 24 hours
		EPISODE_SCHEDULE: 43200000, // 12 hours
		// TV series metadata can change as new seasons are added
		TV_SERIES: 604800000, // 7 days
		// Movie metadata looks static, but a row is written the first time anyone
		// opens the page — which for anticipated titles is months before release,
		// when the synopsis is a placeholder and the poster is a teaser. Without an
		// expiry that pre-release snapshot is served forever.
		MOVIE: 2592000000, // 30 days
	};

	/**
	 * Check if cached data is expired
	 */
	private isCacheExpired(
		updatedAt: Date,
		maxAge: number,
		currentTime: number = Date.now()
	): boolean {
		if (maxAge === 0) return false; // Permanent cache
		const age = currentTime - updatedAt.getTime();
		return age > maxAge;
	}

	/**
	 * Fetch data from URL with caching and optional expiration
	 */
	async fetchWithCache<T = any>(
		url: string,
		cacheKey: string,
		cacheType: string,
		config?: AxiosRequestConfig,
		maxAge: number = 0 // Default to permanent cache
	): Promise<T> {
		// Check cache first
		const cached = await this.cache.getWithMetadata(cacheKey);
		if (cached && !this.isCacheExpired(cached.updatedAt, maxAge)) {
			console.log(`[MetadataCache] Using cached ${cacheType} data for: ${cacheKey}`);
			return cached.data as T;
		}

		// Fetch from API
		console.log(`[MetadataCache] Fetching ${cacheType} data from: ${url}`);
		let data: T | undefined;
		try {
			const response = await axios.get(url, config || {});
			data = response?.data;
		} catch (error) {
			// Now that these entries expire, an upstream outage would otherwise turn a
			// merely stale row into no row at all — and callers render that as "Unknown".
			// Serving the expired copy is strictly better than serving nothing.
			if (cached) {
				console.error(
					`[MetadataCache] Refetch failed for ${cacheKey}, serving stale ${cacheType}`,
					error
				);
				return cached.data as T;
			}
			throw error;
		}

		if (data === undefined) {
			if (cached) {
				console.error(
					`[MetadataCache] Empty response for ${cacheKey}, serving stale ${cacheType}`
				);
				return cached.data as T;
			}
			throw new Error(`Failed to fetch ${cacheType} data from: ${url}`);
		}

		// Cache the response (non-blocking)
		try {
			await this.cache.set(cacheKey, cacheType, data);
			console.log(`[MetadataCache] Cached ${cacheType} data for: ${cacheKey}`);
		} catch (error) {
			console.error(
				`[MetadataCache] Failed to cache ${cacheType} data for: ${cacheKey}`,
				error
			);
			// Continue without caching - still return the data
		}

		return data;
	}

	/**
	 * Fetch Cinemeta movie info with caching
	 */
	async getCinemetaMovie(imdbId: string, config?: AxiosRequestConfig): Promise<any> {
		const url = `https://v3-cinemeta.strem.io/meta/movie/${imdbId}.json`;
		const cacheKey = `cinemeta_movie_${imdbId}`;
		return this.fetchWithCache(
			url,
			cacheKey,
			'cinemeta_movie',
			config,
			this.CACHE_DURATIONS.MOVIE
		);
	}

	/**
	 * Fetch Cinemeta series info with caching
	 */
	async getCinemetaSeries(imdbId: string, config?: AxiosRequestConfig): Promise<any> {
		const url = `https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`;
		const cacheKey = `cinemeta_series_${imdbId}`;
		return this.fetchWithCache(
			url,
			cacheKey,
			'cinemeta_series',
			config,
			this.CACHE_DURATIONS.TV_SERIES
		);
	}

	/**
	 * Search Cinemeta movies with caching
	 */
	async searchCinemetaMovies(keyword: string, config?: AxiosRequestConfig): Promise<any> {
		const url = `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(keyword)}.json`;
		const cacheKey = `cinemeta_search_movie_${keyword}`;
		return this.fetchWithCache(
			url,
			cacheKey,
			'cinemeta_search',
			config,
			this.CACHE_DURATIONS.SEARCH
		);
	}

	/**
	 * Search Cinemeta series with caching
	 */
	async searchCinemetaSeries(keyword: string, config?: AxiosRequestConfig): Promise<any> {
		const url = `https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(keyword)}.json`;
		const cacheKey = `cinemeta_search_series_${keyword}`;
		return this.fetchWithCache(
			url,
			cacheKey,
			'cinemeta_search',
			config,
			this.CACHE_DURATIONS.SEARCH
		);
	}

	/**
	 * Search OMDB with caching
	 */
	async searchOmdb(keyword: string, year?: number, mediaType?: string): Promise<any> {
		const omdbKey = process.env.OMDB_KEY || this.runtimeConfig.omdbKey;
		if (!omdbKey) {
			throw new Error('OMDB_KEY environment variable is not set');
		}

		const url = `https://www.omdbapi.com/?s=${encodeURIComponent(keyword)}&y=${year ?? ''}&apikey=${omdbKey}&type=${mediaType ?? ''}`;
		const cacheKey = `omdb_search_${keyword}_${year || ''}_${mediaType || ''}`;
		return this.fetchWithCache(
			url,
			cacheKey,
			'omdb_search',
			undefined,
			this.CACHE_DURATIONS.SEARCH
		);
	}

	/**
	 * Get OMDB info by IMDB ID with caching
	 */
	async getOmdbInfo(imdbId: string): Promise<any> {
		const omdbKey = process.env.OMDB_KEY || this.runtimeConfig.omdbKey;
		if (!omdbKey) {
			throw new Error('OMDB_KEY environment variable is not set');
		}

		const url = `https://www.omdbapi.com/?i=${imdbId}&apikey=${omdbKey}`;
		const cacheKey = `omdb_info_${imdbId}`;
		return this.fetchWithCache(
			url,
			cacheKey,
			'omdb_info',
			undefined,
			this.CACHE_DURATIONS.MOVIE
		);
	}

	/**
	 * Search TMDB by IMDB ID with caching
	 */
	async searchTmdbByImdb(imdbId: string): Promise<any> {
		const tmdbKey = process.env.TMDB_KEY || this.runtimeConfig.tmdbKey;
		if (!tmdbKey) {
			throw new Error('TMDB_KEY environment variable is not set');
		}

		const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`;
		const cacheKey = `tmdb_find_${imdbId}`;
		// Callers read vote_count off this to decide movie-vs-show, and a title that
		// has no votes yet gains them later, so this cannot be cached permanently.
		return this.fetchWithCache(
			url,
			cacheKey,
			'tmdb_find',
			undefined,
			this.CACHE_DURATIONS.MOVIE
		);
	}

	/**
	 * Get TMDB movie info with caching
	 */
	async getTmdbMovieInfo(tmdbId: string | number): Promise<any> {
		const tmdbKey = process.env.TMDB_KEY || this.runtimeConfig.tmdbKey;
		if (!tmdbKey) {
			throw new Error('TMDB_KEY environment variable is not set');
		}

		const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${tmdbKey}`;
		const cacheKey = `tmdb_movie_${tmdbId}`;
		return this.fetchWithCache(
			url,
			cacheKey,
			'tmdb_movie',
			undefined,
			this.CACHE_DURATIONS.MOVIE
		);
	}

	/**
	 * Get TMDB TV info with caching
	 */
	async getTmdbTvInfo(tmdbId: string | number): Promise<any> {
		const tmdbKey = process.env.TMDB_KEY || this.runtimeConfig.tmdbKey;
		if (!tmdbKey) {
			throw new Error('TMDB_KEY environment variable is not set');
		}

		const url = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${tmdbKey}`;
		const cacheKey = `tmdb_tv_${tmdbId}`;
		return this.fetchWithCache(
			url,
			cacheKey,
			'tmdb_tv',
			undefined,
			this.CACHE_DURATIONS.TV_SERIES
		);
	}

	async getTmdbExternalIds(tmdbId: string | number, mediaType: 'movie' | 'tv'): Promise<any> {
		const tmdbKey = process.env.TMDB_KEY || this.runtimeConfig.tmdbKey;
		if (!tmdbKey) {
			throw new Error('TMDB_KEY environment variable is not set');
		}

		const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/external_ids?api_key=${tmdbKey}`;
		const cacheKey = `tmdb_external_ids_${mediaType}_${tmdbId}`;
		// Deliberately permanent: this is an id-to-id mapping, not descriptive
		// metadata, so it does not go stale the way titles and posters do.
		return this.fetchWithCache(url, cacheKey, 'tmdb_external_ids');
	}

	/**
	 * Get Trakt trending with caching (short cache for trending data)
	 */
	async getTraktTrending(
		type: 'movies' | 'shows',
		genre?: string,
		limit: number = 20
	): Promise<any> {
		const clientId = process.env.TRAKT_CLIENT_ID || this.runtimeConfig.traktClientId;
		if (!clientId) {
			throw new Error('TRAKT_CLIENT_ID environment variable is not set');
		}

		const url = `https://api.trakt.tv/${type}/trending?genres=${genre || ''}&limit=${limit}`;
		const cacheKey = `trakt_trending_${type}_${genre || 'all'}_${limit}`;

		const config: AxiosRequestConfig = {
			headers: {
				'Content-Type': 'application/json',
				'trakt-api-version': '2',
				'trakt-api-key': clientId,
			},
		};

		return this.fetchWithCache(
			url,
			cacheKey,
			'trakt_trending',
			config,
			this.CACHE_DURATIONS.TRENDING
		);
	}

	/**
	 * Get Trakt popular with caching
	 */
	async getTraktPopular(
		type: 'movies' | 'shows',
		genre?: string,
		limit: number = 20
	): Promise<any> {
		const clientId = process.env.TRAKT_CLIENT_ID || this.runtimeConfig.traktClientId;
		if (!clientId) {
			throw new Error('TRAKT_CLIENT_ID environment variable is not set');
		}

		const url = `https://api.trakt.tv/${type}/popular?genres=${genre || ''}&limit=${limit}`;
		const cacheKey = `trakt_popular_${type}_${genre || 'all'}_${limit}`;

		const config: AxiosRequestConfig = {
			headers: {
				'Content-Type': 'application/json',
				'trakt-api-version': '2',
				'trakt-api-key': clientId,
			},
		};

		return this.fetchWithCache(
			url,
			cacheKey,
			'trakt_popular',
			config,
			this.CACHE_DURATIONS.POPULAR
		);
	}

	/**
	 * Get Trakt next/last episode for a show with caching
	 */
	async getTraktShowEpisode(
		showId: string,
		which: 'next_episode' | 'last_episode'
	): Promise<any | null> {
		const clientId = process.env.TRAKT_CLIENT_ID || this.runtimeConfig.traktClientId;
		if (!clientId) return null;

		const url = `https://api.trakt.tv/shows/${showId}/${which}?extended=full`;
		const cacheKey = `trakt_${which}_${showId}`;

		const config: AxiosRequestConfig = {
			headers: {
				'Content-Type': 'application/json',
				'trakt-api-version': '2',
				'trakt-api-key': clientId,
			},
			validateStatus: (status: number) => status === 200 || status === 204,
		};

		try {
			const cached = await this.cache.getWithMetadata(cacheKey);
			if (
				cached &&
				!this.isCacheExpired(cached.updatedAt, this.CACHE_DURATIONS.EPISODE_SCHEDULE)
			) {
				return cached.data;
			}

			const response = await axios.get(url, config);
			if (response.status === 204 || !response.data) {
				await this.cache.set(cacheKey, `trakt_${which}`, null);
				return null;
			}

			await this.cache.set(cacheKey, `trakt_${which}`, response.data);
			return response.data;
		} catch (error) {
			console.error(`[MetadataCache] Failed to fetch Trakt ${which} for ${showId}`, error);
			return null;
		}
	}

	/**
	 * Search Trakt with caching
	 */
	async searchTrakt(query: string, type?: 'movie' | 'show'): Promise<any> {
		const clientId = process.env.TRAKT_CLIENT_ID || this.runtimeConfig.traktClientId;
		if (!clientId) {
			throw new Error('TRAKT_CLIENT_ID environment variable is not set');
		}

		const typeParam = type ? type : 'movie,show';
		const url = `https://api.trakt.tv/search/${typeParam}?query=${encodeURIComponent(query)}`;
		const cacheKey = `trakt_search_${query}_${typeParam}`;

		const config: AxiosRequestConfig = {
			headers: {
				'Content-Type': 'application/json',
				'trakt-api-version': '2',
				'trakt-api-key': clientId,
			},
		};

		return this.fetchWithCache(
			url,
			cacheKey,
			'trakt_search',
			config,
			this.CACHE_DURATIONS.SEARCH
		);
	}
}

// Create singleton instance
let metadataCacheInstance: MetadataCacheService | null = null;

export function getMetadataCache(): MetadataCacheService {
	if (!metadataCacheInstance) {
		metadataCacheInstance = new MetadataCacheService();
	}
	return metadataCacheInstance;
}
