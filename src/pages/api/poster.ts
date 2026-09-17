import { getMdblistCacheService } from '@/services/database/mdblistCache';
import { getMdblistClient } from '@/services/mdblistClient';
import { getOmdbMetadata, getOmdbPoster } from '@/utils/omdb';
import { TmdbResponse } from '@/utils/tmdb';
import { getTmdbAuthWithFreeKey, tmdbRequestConfig, tmdbUrl } from '@/utils/tmdbAuth';
import axios from 'axios';
import type { NextApiRequest, NextApiResponse } from 'next';

interface FanartPoster {
	id: string;
	url: string;
	lang: string;
	likes: string;
}

interface FanartMovieResponse {
	movieposter?: FanartPoster[];
}

// This route is the poster component's third fallback, so it is reached only for
// titles whose art is already missing from two CDNs — exactly the long tail that
// then misses several of the sources below too. Caching the resolved URL keeps a
// popular-but-artless title from re-querying every source on every render.
const POSTER_CACHE_HIT = 2592000000; // 30 days
// A title with no poster anywhere usually gains one later, so a miss is retried
// the next day rather than held for the full month.
const POSTER_CACHE_MISS = 86400000; // 24 hours

function isCacheExpired(updatedAt: Date, maxAge: number): boolean {
	return Date.now() - updatedAt.getTime() > maxAge;
}

async function getFanartPoster(imdbId: string): Promise<string | null> {
	const apiKey = process.env.FANART_KEY;
	if (!apiKey) return null;

	try {
		const resp = await axios.get<FanartMovieResponse>(
			`https://webservice.fanart.tv/v3/movies/${imdbId}?api_key=${apiKey}`
		);
		const posters = resp.data.movieposter;
		if (!posters?.length) return null;

		// Prefer English posters, sorted by most likes
		const sorted = [...posters].sort((a, b) => {
			if (a.lang === 'en' && b.lang !== 'en') return -1;
			if (a.lang !== 'en' && b.lang === 'en') return 1;
			return Number(b.likes) - Number(a.likes);
		});

		return sorted[0].url;
	} catch {
		return null;
	}
}

async function resolvePoster(imdbid: string): Promise<string | null> {
	const mdblistClient = getMdblistClient();
	// Keeps the shared free-key pool as the last resort, and picks up the v4
	// read token when one is configured.
	const tmdbAuth = getTmdbAuthWithFreeKey();

	// A rejected source has no opinion on whether art exists, so it must not be
	// recorded as a miss. Collected across both waves and rethrown at the end.
	const failures: unknown[] = [];

	const pick = async (sources: Array<() => Promise<string | null>>): Promise<string | null> => {
		const settled = await Promise.allSettled(sources.map((source) => source()));
		for (const result of settled) {
			if (result.status === 'fulfilled' && result.value) return result.value;
			if (result.status === 'rejected') failures.push(result.reason);
		}
		return null;
	};

	// Wave 1: Fanart and TMDB together. Asking them at once rather than in turn
	// costs the slower of the two instead of their sum.
	const generous = await pick([
		// Fanart.tv covers movies only; it keys TV art by TVDB id, not IMDb.
		() => getFanartPoster(imdbid),
		// TMDB covers both movies and TV.
		async () => {
			const resp = await axios.get<TmdbResponse>(
				tmdbUrl(`/find/${imdbid}`, { external_source: 'imdb_id' }, tmdbAuth),
				tmdbRequestConfig(tmdbAuth)
			);
			const posterPath =
				resp.data.movie_results[0]?.poster_path || resp.data.tv_results[0]?.poster_path;
			return posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : null;
		},
	]);
	if (generous) return generous;

	// Wave 2, reached only when neither of the above had art. OMDb is the most
	// rate-limited source DMM uses, so it stays behind that check rather than
	// being asked on every call — the same reason /api/info/show defers it.
	const lastResort = await pick([
		// OMDb's poster is IMDb's own art and covers titles TMDB skips. The URL
		// it returns is on m.media-amazon.com and carries no API key, so it can
		// be handed to the browser as-is.
		async () => getOmdbPoster(await getOmdbMetadata(imdbid)),
		async () => {
			const resp = await mdblistClient.getInfoByImdbId(imdbid);
			return resp.poster?.startsWith('http') ? resp.poster : null;
		},
	]);
	if (lastResort) return lastResort;

	// Nothing was found. If a source threw rather than simply having no art, let
	// the caller see that so it does not record a miss the title may not deserve.
	if (failures.length > 0) throw failures[0];

	return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { imdbid } = req.query;

	if (!imdbid || typeof imdbid !== 'string') {
		return res.status(400).json({ error: 'IMDB ID is required' });
	}

	const cache = getMdblistCacheService();
	const cacheKey = `poster_${imdbid}`;

	try {
		const cached = await cache.getWithMetadata(cacheKey);
		if (cached) {
			const url = (cached.data as { url: string | null } | null)?.url ?? null;
			const maxAge = url ? POSTER_CACHE_HIT : POSTER_CACHE_MISS;
			if (!isCacheExpired(cached.updatedAt, maxAge)) {
				return url
					? res.json({ url })
					: res.status(404).json({ error: 'Poster not found' });
			}
		}
	} catch (error) {
		// An unreachable cache is a slow path, not a failure: fall through and ask
		// the sources directly.
		console.error('[poster] cache read failed', error);
	}

	try {
		const url = await resolvePoster(imdbid);
		await cache.set(cacheKey, 'poster', { url }).catch(() => {});

		if (url) return res.json({ url });
		return res.status(404).json({ error: 'Poster not found' });
	} catch (error) {
		// A source threw rather than simply having no art. That says nothing about
		// whether a poster exists, so it is deliberately not cached as a miss.
		return res.status(404).json({ error: 'Poster not found' });
	}
}
