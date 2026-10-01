import {
	cinemetaReleaseSignals,
	metadataMaxAge,
	omdbReleaseSignals,
	tmdbMovieReleaseSignals,
	tmdbTvReleaseSignals,
	traktSeasonsReleaseSignals,
	traktSummaryReleaseSignals,
	tvmazeReleaseSignals,
	type ReleaseSignals,
} from '@/utils/metadataFreshness';
import { getTmdbAuth, tmdbRequestConfig, tmdbUrl, type TmdbAuth } from '@/utils/tmdbAuth';
import axios, { AxiosRequestConfig } from 'axios';
import getConfig from 'next/config';
import { getMdblistCacheService } from './database/mdblistCache';

/**
 * A fixed lifetime, or one derived from the row already in the cache — which is
 * how a title that is still being rated gets a shorter TTL than one that settled
 * decades ago. See `@/utils/metadataFreshness`.
 */
export type MaxAge = number | ((cached: unknown) => number);

const resolveMaxAge = (maxAge: MaxAge, cached: unknown): number =>
	typeof maxAge === 'function' ? maxAge(cached) : maxAge;

export class MetadataCacheService {
	private cache = getMdblistCacheService();

	private get runtimeConfig() {
		const config = getConfig();
		return config?.publicRuntimeConfig || {};
	}

	/**
	 * The v4 read token counts as configured just as the v3 key does; with
	 * neither, these calls still fail loudly rather than hitting TMDB
	 * unauthenticated.
	 */
	private requireTmdbAuth(): TmdbAuth {
		const auth = getTmdbAuth(this.runtimeConfig.tmdbKey);
		if (!auth) {
			throw new Error('TMDB_KEY environment variable is not set');
		}
		return auth;
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
		// Id-to-id mappings barely move, but a title TVmaze does not know yet may
		// be added, so a miss is remembered for a week rather than forever.
		ID_MAPPING: 2592000000, // 30 days
		ID_MAPPING_MISS: 604800000, // 7 days
		// Person slugs are looked up by name and do not change.
		PERSON: 2592000000, // 30 days
	};

	private static readonly TVMAZE_BASE = 'https://api.tvmaze.com';

	// A provider that stops answering must not hold a page, or an internal
	// caller, open with it. Past this the stale row is served, or nothing.
	private static readonly REQUEST_TIMEOUT_MS = 10000;

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
	 * A Cinemeta row's lifetime, read off the row itself: a title that is still
	 * being rated expires in hours, a settled one keeps the long lifetime it
	 * always had. Deciding from the cached payload costs no extra request.
	 */
	private cinemetaMaxAge(settledMaxAge: number): MaxAge {
		return (cached: unknown) =>
			metadataMaxAge(
				cinemetaReleaseSignals((cached as { meta?: unknown } | null)?.meta),
				settledMaxAge
			);
	}

	/** A lifetime read off the cached payload by one of `@/utils/metadataFreshness`'s extractors. */
	private freshnessMaxAge(
		signals: (cached: any) => ReleaseSignals,
		settledMaxAge: number
	): MaxAge {
		return (cached: unknown) => metadataMaxAge(signals(cached), settledMaxAge);
	}

	/** Writes a row, logging rather than failing when the cache table is unavailable. */
	private async store(cacheKey: string, cacheType: string, data: unknown): Promise<void> {
		try {
			await this.cache.set(cacheKey, cacheType, data);
		} catch (error) {
			console.error(`[MetadataCache] Failed to cache ${cacheKey}`, error);
		}
	}

	private traktHeaders(clientId: string) {
		return {
			'Content-Type': 'application/json',
			'trakt-api-version': '2',
			'trakt-api-key': clientId,
		};
	}

	private get traktClientId(): string | undefined {
		return process.env.TRAKT_CLIENT_ID || this.runtimeConfig.traktClientId || undefined;
	}

	/**
	 * Fetch data from URL with caching and optional expiration
	 */
	async fetchWithCache<T = any>(
		url: string,
		cacheKey: string,
		cacheType: string,
		config?: AxiosRequestConfig,
		maxAge: MaxAge = 0 // Default to permanent cache
	): Promise<T> {
		// Check cache first
		const cached = await this.cache.getWithMetadata(cacheKey);
		if (cached && !this.isCacheExpired(cached.updatedAt, resolveMaxAge(maxAge, cached.data))) {
			console.log(`[MetadataCache] Using cached ${cacheType} data for: ${cacheKey}`);
			return cached.data as T;
		}

		// Fetch from API
		console.log(`[MetadataCache] Fetching ${cacheType} data from: ${url}`);
		let data: T | undefined;
		try {
			const response = await axios.get(url, {
				timeout: MetadataCacheService.REQUEST_TIMEOUT_MS,
				...config,
			});
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
			this.cinemetaMaxAge(this.CACHE_DURATIONS.MOVIE)
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
			this.cinemetaMaxAge(this.CACHE_DURATIONS.TV_SERIES)
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
		// A series row carries its season total, which grows while the show airs;
		// a movie row keeps the lifetime it always had.
		const maxAge: MaxAge = (cached: any) =>
			cached?.Type === 'series'
				? metadataMaxAge(omdbReleaseSignals(cached), this.CACHE_DURATIONS.TV_SERIES)
				: this.CACHE_DURATIONS.MOVIE;
		return this.fetchWithCache(url, cacheKey, 'omdb_info', undefined, maxAge);
	}

	/**
	 * Search TMDB by IMDB ID with caching
	 */
	async searchTmdbByImdb(imdbId: string): Promise<any> {
		const auth = this.requireTmdbAuth();
		const url = tmdbUrl(`/find/${imdbId}`, { external_source: 'imdb_id' }, auth);
		const cacheKey = `tmdb_find_${imdbId}`;
		// Callers read vote_count off this to decide movie-vs-show, and a title that
		// has no votes yet gains them later, so this cannot be cached permanently.
		return this.fetchWithCache(
			url,
			cacheKey,
			'tmdb_find',
			tmdbRequestConfig(auth),
			this.CACHE_DURATIONS.MOVIE
		);
	}

	/**
	 * Get TMDB movie info with caching. A film's page settles once it has been
	 * out a while; a recent or upcoming one keeps changing (release dates, art).
	 */
	async getTmdbMovieInfo(tmdbId: string | number, appendToResponse?: string): Promise<any> {
		const auth = this.requireTmdbAuth();
		const url = tmdbUrl(
			`/movie/${tmdbId}`,
			appendToResponse ? { append_to_response: appendToResponse } : {},
			auth
		);
		const cacheKey = appendToResponse
			? `tmdb_movie_${tmdbId}_${appendToResponse}`
			: `tmdb_movie_${tmdbId}`;
		return this.fetchWithCache(
			url,
			cacheKey,
			'tmdb_movie',
			tmdbRequestConfig(auth),
			this.freshnessMaxAge(tmdbMovieReleaseSignals, this.CACHE_DURATIONS.MOVIE)
		);
	}

	/**
	 * Get TMDB TV info with caching
	 */
	async getTmdbTvInfo(tmdbId: string | number, appendToResponse?: string): Promise<any> {
		const auth = this.requireTmdbAuth();
		const url = tmdbUrl(
			`/tv/${tmdbId}`,
			appendToResponse ? { append_to_response: appendToResponse } : {},
			auth
		);
		const cacheKey = appendToResponse
			? `tmdb_tv_${tmdbId}_${appendToResponse}`
			: `tmdb_tv_${tmdbId}`;
		// The payload names the next episode and the status, so an airing show's
		// row lives hours and an ended one's a week.
		return this.fetchWithCache(
			url,
			cacheKey,
			'tmdb_tv',
			tmdbRequestConfig(auth),
			this.freshnessMaxAge(tmdbTvReleaseSignals, this.CACHE_DURATIONS.TV_SERIES)
		);
	}

	async getTmdbExternalIds(tmdbId: string | number, mediaType: 'movie' | 'tv'): Promise<any> {
		const auth = this.requireTmdbAuth();
		const url = tmdbUrl(`/${mediaType}/${tmdbId}/external_ids`, {}, auth);
		const cacheKey = `tmdb_external_ids_${mediaType}_${tmdbId}`;
		// Deliberately permanent: this is an id-to-id mapping, not descriptive
		// metadata, so it does not go stale the way titles and posters do.
		return this.fetchWithCache(url, cacheKey, 'tmdb_external_ids', tmdbRequestConfig(auth));
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

			const response = await axios.get(url, {
				timeout: MetadataCacheService.REQUEST_TIMEOUT_MS,
				...config,
			});
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
	 * Trakt's season list for a show, or null when Trakt is unconfigured, does not
	 * know the id, or is unreachable with nothing cached. Show pages fall back to
	 * the other providers rather than failing on Trakt.
	 */
	async getTraktShowSeasons(showId: string): Promise<any[] | null> {
		const clientId = this.traktClientId;
		if (!clientId) return null;

		const url = `https://api.trakt.tv/shows/${encodeURIComponent(showId)}/seasons?extended=full`;
		try {
			const data = await this.fetchWithCache<any>(
				url,
				`trakt_seasons_${showId}`,
				'trakt_seasons',
				{
					headers: this.traktHeaders(clientId),
					// An unknown id is an answer, not an outage, and is cached as one.
					validateStatus: (status: number) => status === 200 || status === 404,
				},
				this.freshnessMaxAge(traktSeasonsReleaseSignals, this.CACHE_DURATIONS.TV_SERIES)
			);
			return Array.isArray(data) ? data : null;
		} catch (error) {
			console.error(`[MetadataCache] Failed to fetch Trakt seasons for ${showId}`, error);
			return null;
		}
	}

	/**
	 * TVmaze's show for an IMDb id, with its seasons and its next and previous
	 * episodes embedded, or null.
	 *
	 * TVmaze answers a lookup with a redirect to `/shows/{id}` that drops any
	 * `embed` parameter, so the id is resolved and cached on its own first. A
	 * miss is cached too: TVmaze has no entry for most of the long tail, and
	 * without that every page view for one of them would spend a lookup against
	 * the per-IP limit every DMM user shares.
	 */
	async getTvmazeShow(imdbId: string): Promise<any | null> {
		try {
			const tvmazeId = await this.getTvmazeIdForImdb(imdbId);
			if (!tvmazeId) return null;

			const url = `${MetadataCacheService.TVMAZE_BASE}/shows/${tvmazeId}?embed[]=seasons&embed[]=nextepisode&embed[]=previousepisode`;
			const cacheKey = `tvmaze_show_${tvmazeId}`;
			const cached = await this.cache.getWithMetadata(cacheKey);
			const maxAge = metadataMaxAge(
				tvmazeReleaseSignals(cached?.data),
				this.CACHE_DURATIONS.TV_SERIES
			);
			if (cached && !this.isCacheExpired(cached.updatedAt, maxAge)) {
				return cached.data;
			}

			try {
				const response = await axios.get(url, {
					timeout: MetadataCacheService.REQUEST_TIMEOUT_MS,
				});
				const slim = slimTvmazeShow(response.data);
				await this.store(cacheKey, 'tvmaze_show', slim);
				return slim;
			} catch (error) {
				if (cached) {
					console.error(
						`[MetadataCache] Refetch failed for ${cacheKey}, serving stale`,
						error
					);
					return cached.data;
				}
				throw error;
			}
		} catch (error) {
			console.error(`[MetadataCache] Failed to fetch TVmaze show for ${imdbId}`, error);
			return null;
		}
	}

	private async getTvmazeIdForImdb(imdbId: string): Promise<number | null> {
		const cacheKey = `tvmaze_lookup_${imdbId}`;
		const cached = await this.cache.getWithMetadata(cacheKey);
		if (cached) {
			const id = (cached.data as { id?: number | null } | null)?.id ?? null;
			const maxAge = id
				? this.CACHE_DURATIONS.ID_MAPPING
				: this.CACHE_DURATIONS.ID_MAPPING_MISS;
			if (!this.isCacheExpired(cached.updatedAt, maxAge)) return id;
		}

		const response = await axios.get(
			`${MetadataCacheService.TVMAZE_BASE}/lookup/shows?imdb=${encodeURIComponent(imdbId)}`,
			{
				timeout: MetadataCacheService.REQUEST_TIMEOUT_MS,
				validateStatus: (status: number) => status === 200 || status === 404,
			}
		);
		const id =
			response.status === 200 && typeof response.data?.id === 'number'
				? response.data.id
				: null;
		await this.store(cacheKey, 'tvmaze_lookup', { id });
		return id;
	}

	/**
	 * Trakt's best person match for a name, cached: a show-details page asks this
	 * for up to fifteen cast members at once.
	 */
	async searchTraktPerson(name: string): Promise<any | null> {
		const clientId = this.traktClientId;
		if (!clientId) return null;
		const url = `https://api.trakt.tv/search/person?query=${encodeURIComponent(name)}`;
		const data = await this.fetchWithCache<any[]>(
			url,
			`trakt_search_person_${name}`,
			'trakt_search_person',
			{ headers: this.traktHeaders(clientId) },
			this.CACHE_DURATIONS.PERSON
		);
		return Array.isArray(data) ? (data[0]?.person ?? null) : null;
	}

	/**
	 * Trakt's summary of a movie or show (`extended=full`), or null when Trakt
	 * is unconfigured, does not know the id, or is unreachable with nothing cached.
	 */
	async getTraktSummary(type: 'movies' | 'shows', id: string): Promise<any | null> {
		const clientId = this.traktClientId;
		if (!clientId) return null;
		try {
			const data = await this.fetchWithCache<any>(
				`https://api.trakt.tv/${type}/${encodeURIComponent(id)}?extended=full`,
				`trakt_summary_${type}_${id}`,
				'trakt_summary',
				{
					headers: this.traktHeaders(clientId),
					validateStatus: (status: number) => status === 200 || status === 404,
				},
				this.freshnessMaxAge(
					traktSummaryReleaseSignals,
					type === 'movies' ? this.CACHE_DURATIONS.MOVIE : this.CACHE_DURATIONS.TV_SERIES
				)
			);
			return data && typeof data === 'object' && data.ids ? data : null;
		} catch (error) {
			console.error(`[MetadataCache] Failed to fetch Trakt ${type} summary for ${id}`, error);
			return null;
		}
	}

	/**
	 * TMDB title search, for resolving a release name to an id. Cached a day:
	 * the same parsed titles arrive again and again from the uploaders.
	 */
	async searchTmdbTitles(kind: 'movie' | 'tv', query: string, year?: number): Promise<any> {
		const auth = this.requireTmdbAuth();
		const params: Record<string, string> = { query };
		if (year) params[kind === 'movie' ? 'year' : 'first_air_date_year'] = String(year);
		return this.fetchWithCache(
			tmdbUrl(`/search/${kind}`, params, auth),
			`tmdb_search_${kind}_${query.toLowerCase()}_${year ?? ''}`,
			'tmdb_search',
			tmdbRequestConfig(auth),
			this.CACHE_DURATIONS.TOP_LISTS
		);
	}

	/** Trakt title search with an optional year; see `searchTmdbTitles`. */
	async searchTraktTitles(
		kind: 'movie' | 'show',
		query: string,
		year?: number
	): Promise<any[] | null> {
		const clientId = this.traktClientId;
		if (!clientId) return null;
		const url = `https://api.trakt.tv/search/${kind}?query=${encodeURIComponent(query)}${year ? `&years=${year}` : ''}`;
		const data = await this.fetchWithCache<any[]>(
			url,
			`trakt_search_${kind}_${query.toLowerCase()}_${year ?? ''}`,
			'trakt_search',
			{ headers: this.traktHeaders(clientId) },
			this.CACHE_DURATIONS.TOP_LISTS
		);
		return Array.isArray(data) ? data : null;
	}

	/**
	 * OMDb's exact-title lookup. Its year filter is the US release year, so no
	 * year is sent; the resolver checks the year against the canonical record.
	 */
	async getOmdbByTitle(title: string, type: 'movie' | 'series'): Promise<any | null> {
		const omdbKey = process.env.OMDB_KEY || this.runtimeConfig.omdbKey;
		if (!omdbKey) return null;
		const data = await this.fetchWithCache<any>(
			`https://www.omdbapi.com/?t=${encodeURIComponent(title)}&type=${type}&apikey=${omdbKey}`,
			`omdb_title_${type}_${title.toLowerCase()}`,
			'omdb_title',
			undefined,
			this.CACHE_DURATIONS.TOP_LISTS
		);
		return data?.Response === 'True' ? data : null;
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

/**
 * The fields of a TVmaze show DMM reads. The full payload repeats every season's
 * network, images and links, and the cache table is read whole.
 */
function slimTvmazeShow(data: any) {
	if (!data || typeof data !== 'object') return data;
	const embedded = data._embedded ?? {};
	const pickEpisode = (episode: any) =>
		episode
			? {
					season: episode.season,
					number: episode.number,
					name: episode.name,
					airdate: episode.airdate,
					airstamp: episode.airstamp,
				}
			: undefined;
	return {
		id: data.id,
		name: data.name,
		status: data.status,
		premiered: data.premiered,
		ended: data.ended,
		externals: data.externals,
		_embedded: {
			seasons: Array.isArray(embedded.seasons)
				? embedded.seasons.map((season: any) => ({
						number: season?.number,
						episodeOrder: season?.episodeOrder,
						premiereDate: season?.premiereDate,
						endDate: season?.endDate,
					}))
				: [],
			nextepisode: pickEpisode(embedded.nextepisode),
			previousepisode: pickEpisode(embedded.previousepisode),
		},
	};
}

// Create singleton instance
let metadataCacheInstance: MetadataCacheService | null = null;

export function getMetadataCache(): MetadataCacheService {
	if (!metadataCacheInstance) {
		metadataCacheInstance = new MetadataCacheService();
	}
	return metadataCacheInstance;
}
