/**
 * The anime ids DMM Cast accepts from Stremio, with nothing to import: the
 * manifests read the constants, and a manifest route has no reason to load the
 * database client. `stremioAnime.ts` resolves them.
 */
import type { AnimeIdSource } from '@/services/database/anime';

/**
 * `kitsu` is what anime catalogs' video ids use. `mal` and `anidb` are the other
 * ids the Anime Kitsu addon accepts for its metadata, and MediaFusion's stream
 * resource takes `mal:` as well; each resolves through the same table, so
 * accepting them costs nothing when a catalog does hand them out.
 */
export const ANIME_STREAM_ID_PREFIXES = ['kitsu', 'mal', 'anidb'] as const;

/**
 * The stream resource every DMM Cast manifest declares. `anime` is a type some
 * anime catalogs give their items; Torrentio lists it for the same reason.
 */
export const CAST_STREAM_RESOURCE = {
	name: 'stream',
	types: ['movie', 'series', 'anime'],
	idPrefixes: ['tt', ...ANIME_STREAM_ID_PREFIXES],
};

export interface StremioAnimeId {
	source: AnimeIdSource;
	id: number;
	/** Only a `<prefix>:<id>:<season>:<episode>` id names one. */
	season: number | null;
	episode: number | null;
}

/** `kitsu:46474`, `kitsu:46474:5`, `mal:52991:5`, `anidb:17617:1:5`. */
export function parseStremioAnimeId(videoId: string): StremioAnimeId | null {
	const match = /^(kitsu|mal|anidb):(\d+)(?::(\d+))?(?::(\d+))?$/i.exec(videoId.trim());
	if (!match) return null;
	const id = Number(match[2]);
	if (!Number.isSafeInteger(id) || id <= 0) return null;
	const first = match[3] !== undefined ? Number(match[3]) : null;
	const second = match[4] !== undefined ? Number(match[4]) : null;
	return {
		source: match[1].toLowerCase() as AnimeIdSource,
		id,
		season: second !== null ? first : null,
		episode: second !== null ? second : first,
	};
}

/**
 * The id the anime cast route files an AniDB entry under.
 *
 * The page that calls it has passed `anidb-17617` (every cast row from 2024
 * has that shape) and may pass the bare `17617`, so both, and the `anime:` and
 * `anidb:` spellings search and Stremio use, become `anidb-17617`. Anything else
 * is kept as it came, as it always was.
 */
export function canonicalAnimeCastId(raw: string): string {
	const match = /^(?:anime:)?(?:anidb[-:]?)?(\d+)$/i.exec(raw.trim());
	return match && Number(match[1]) > 0 ? `anidb-${Number(match[1])}` : raw;
}
