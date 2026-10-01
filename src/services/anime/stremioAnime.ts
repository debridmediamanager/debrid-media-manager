/**
 * What a DMM Cast stream request is for: a title's cast key, its DMM page and
 * its scraped releases, whether Stremio asked by IMDb id or by an anime id.
 *
 * Every DMM Cast manifest accepted only `tt` ids, while anime catalogs hand out
 * their own. The Anime Kitsu addon, the catalog Stremio's own addon list offers
 * for anime, lists `kitsu:46474` for Frieren and names its episodes
 * `kitsu:46474:1`...`kitsu:46474:28` - it resolves `mal:52991` and
 * `anidb:17617` too, into those same Kitsu video ids (measured 2026-09-27). So
 * Stremio never asked DMM for an anime stream at all, and what the anime cast
 * route saved under `anidb-<aid>:<season>:<episode>` could not be played.
 *
 * An anime id resolves through the `Anime` table to the AniDB id the cast
 * route and the `anime:anidb-<aid>` release rows are keyed by. Kitsu numbers a
 * season's episodes from 1 and so does AniDB, so `kitsu:<id>:<n>` is episode n
 * of that AniDB entry, which the cast route files as season 1.
 */
import type { AnimeIdSource } from '@/services/database/anime';
import { repository } from '@/services/repository';
import { parseAnimeEpisode } from '@/utils/animeEpisodes';
import { getTroveCandidates, type TroveStreamCandidate } from '@/utils/cachedTroveStreams';
import { MAX_SIZE_MB, MIN_SIZE_MB } from '@/utils/releaseSize';
import { namedSeasons } from '@/utils/seasonNaming';
import { parseStremioAnimeId, type StremioAnimeId } from './stremioAnimeIds';

export {
	ANIME_STREAM_ID_PREFIXES,
	canonicalAnimeCastId,
	CAST_STREAM_RESOURCE,
	parseStremioAnimeId,
	type StremioAnimeId,
} from './stremioAnimeIds';

type RowLookup = (
	source: AnimeIdSource,
	id: number
) => Promise<{ anidb_id: number | null; mal_id: number | null } | null>;

export interface AnimeStreamTarget {
	anidbId: number | null;
	malId: number | null;
	/** Where the cast route files this video; the bare id for a film. */
	castKey: string;
	/** Release rows are keyed by anidb id, or by mal id for a row that had none. */
	troveKeys: string[];
	episode: number | null;
}

export async function resolveAnimeStreamTarget(
	id: StremioAnimeId,
	lookup: RowLookup
): Promise<AnimeStreamTarget | null> {
	let row: { anidb_id: number | null; mal_id: number | null } | null = null;
	try {
		row = await lookup(id.source, id.id);
	} catch (error) {
		console.error(
			'[Stremio anime] Anime row lookup failed:',
			error instanceof Error ? error.message : 'Unknown error'
		);
	}
	const anidbId = id.source === 'anidb' ? id.id : (row?.anidb_id ?? null);
	const malId = id.source === 'mal' ? id.id : (row?.mal_id ?? null);
	if (anidbId === null && malId === null) return null;

	const base = anidbId !== null ? `anidb-${anidbId}` : `mal-${malId}`;
	const castKey = id.episode === null ? base : `${base}:${id.season ?? 1}:${id.episode}`;
	const troveKeys = [
		...(anidbId !== null ? [`anime:anidb-${anidbId}`] : []),
		...(malId !== null ? [`anime:mal-${malId}`] : []),
	];
	return { anidbId, malId, castKey, troveKeys, episode: id.episode };
}

/**
 * The episodes a release title names, in the numbering fansub and web releases
 * use: `Sousou no Frieren - 07`, `S01E08`, `E27`, `第5話`. A range
 * (`S01E01-E04`, `- 01 ~ 28`) names its first and last episode, so it counts
 * as more than one; a pack that names no range names none. The season is the
 * one the title names, or null when it names none, which is how absolute
 * numbering (`One Piece - 1100`) looks.
 *
 * The episode is read by `parseAnimeEpisode`, the parser the anime page and
 * `/api/torrents/anime` group releases by, so an episode the page lists is the
 * episode Stremio is offered.
 */
export function animeEpisodesNamed(title: string): { season: number | null; episodes: number[] } {
	const match = parseAnimeEpisode(title);
	const episodes =
		match === null
			? []
			: match.kind === 'episode'
				? [match.episode]
				: match.from !== undefined && match.to !== undefined
					? [match.from, match.to]
					: [];

	// SubsPlease's `Honzuki no Gekokujou S4 - 23` is season 4, episode 23;
	// `namedSeasons` reads the same text as the season range 4-23.
	const fansubSeason = /(?:^|[^a-z0-9])s(\d{1,2})\s[-–]\s\d{1,4}(?![0-9])/i.exec(title);
	const seasons = fansubSeason ? new Set([Number(fansubSeason[1])]) : namedSeasons(title);
	return {
		season: seasons.size === 1 ? Array.from(seasons)[0] : null,
		episodes,
	};
}

/** One stored release, in either shape `anime:*` rows hold (see `/api/torrents/anime`). */
interface StoredRelease {
	hash?: unknown;
	title?: unknown;
	filename?: unknown;
	fileSize?: unknown;
	size_bytes?: unknown;
}

const HIDDEN_TITLE_LEAD = /^[А-Яа-яЁё]/;
const DEFAULT_MAX_COUNT = 200;

/**
 * The releases a Stremio addon may offer for one anime video.
 *
 * A film takes every release. An episode takes releases whose title names that
 * episode and no other, because playing a bare hash hands back the torrent's
 * biggest file. A title that names a season must name the season most of this
 * entry's releases name: an entry's rows mostly say `S02` when the entry is a
 * second season, and a stray `S01E05` in them is the first season's episode 5.
 */
export function filterAnimeTroveCandidates(
	stored: unknown[] | null | undefined,
	options: { episode: number | null; maxSizeGb?: number; maxCount?: number }
): TroveStreamCandidate[] {
	if (!stored || stored.length === 0) return [];
	const { episode, maxSizeGb, maxCount = DEFAULT_MAX_COUNT } = options;
	const ceilingMb = maxSizeGb && maxSizeGb > 0 ? maxSizeGb * 1024 : undefined;

	const releases: { hash: string; title: string; sizeMb: number }[] = [];
	for (const raw of stored as StoredRelease[]) {
		if (!raw || typeof raw.hash !== 'string') continue;
		const title =
			typeof raw.title === 'string' && raw.title.trim() !== ''
				? raw.title
				: typeof raw.filename === 'string'
					? raw.filename
					: '';
		const sizeMb = Number(raw.fileSize ?? raw.size_bytes);
		if (title.trim() === '' || HIDDEN_TITLE_LEAD.test(title)) continue;
		if (!Number.isFinite(sizeMb) || sizeMb <= MIN_SIZE_MB || sizeMb > MAX_SIZE_MB) continue;
		if (ceilingMb !== undefined && sizeMb > ceilingMb) continue;
		releases.push({ hash: raw.hash, title, sizeMb });
	}

	let wanted = releases;
	if (episode !== null) {
		const named = releases.map((release) => ({
			release,
			...animeEpisodesNamed(release.title),
		}));
		const seasonVotes = new Map<number, number>();
		for (const entry of named) {
			if (entry.season !== null && entry.episodes.length === 1) {
				seasonVotes.set(entry.season, (seasonVotes.get(entry.season) ?? 0) + 1);
			}
		}
		const dominant = Array.from(seasonVotes.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
		wanted = named
			.filter(
				(entry) =>
					entry.episodes.length === 1 &&
					entry.episodes[0] === episode &&
					(entry.season === null || entry.season === dominant)
			)
			.map((entry) => entry.release);
	}

	// The same encode is scraped under several infohashes; the cast pool and
	// the IMDb trove both deduplicate by size for that reason.
	const seenSizes = new Set<number>();
	const seenHashes = new Set<string>();
	const candidates: TroveStreamCandidate[] = [];
	for (const release of wanted.sort((a, b) => b.sizeMb - a.sizeMb)) {
		const hash = release.hash.toLowerCase();
		const sizeKey = Math.round(release.sizeMb);
		if (seenHashes.has(hash) || seenSizes.has(sizeKey)) continue;
		seenHashes.add(hash);
		seenSizes.add(sizeKey);
		candidates.push({ hash: release.hash, title: release.title, sizeMb: release.sizeMb });
	}
	return candidates.slice(0, maxCount);
}

export interface StreamTarget {
	/** The id cast rows for this video are stored under. */
	castKey: string;
	typeSlug: 'movie' | 'show';
	/** The DMM page a viewer casts this title from. */
	externalUrl: string;
	/** Scraped releases for this video, before any cache probe. */
	trove: (maxSizeGb?: number) => Promise<TroveStreamCandidate[]>;
}

/**
 * Resolve a stream request's video id. Null means an anime id the table
 * cannot place, which has no casts and no releases to offer.
 */
export async function resolveStreamTarget(
	videoId: string,
	mediaType: string,
	origin: string | undefined,
	lookup: RowLookup = (source, id) => repository.getAnimeByExternalId(source, id)
): Promise<StreamTarget | null> {
	const anime = parseStremioAnimeId(videoId);
	if (anime) {
		const target = await resolveAnimeStreamTarget(anime, lookup);
		if (!target) return null;
		const page =
			target.anidbId !== null ? `anime/${target.anidbId}` : `anime/mal-${target.malId}`;
		return {
			castKey: target.castKey,
			typeSlug: target.episode === null ? 'movie' : 'show',
			externalUrl: `${origin}/${page}`,
			trove: async (maxSizeGb) => {
				const rows = await Promise.all(
					target.troveKeys.map((key) => repository.getAllScrapedTrueResults(key))
				);
				return filterAnimeTroveCandidates(
					rows.flatMap((row) => (Array.isArray(row) ? row : [])),
					{ episode: target.episode, maxSizeGb }
				);
			},
		};
	}

	const typeSlug = mediaType === 'movie' ? 'movie' : 'show';
	let externalUrl = `${origin}/${typeSlug}/${videoId}`;
	if (typeSlug === 'show') {
		// videoId = imdbid:season:episode, and the page is /show/imdbid/season
		const [imdbId, season] = videoId.split(':');
		externalUrl = `${origin}/${typeSlug}/${imdbId}/${season}`;
	}
	return {
		castKey: videoId,
		typeSlug,
		externalUrl,
		trove: (maxSizeGb) =>
			getTroveCandidates({
				mediaType: typeSlug === 'movie' ? 'movie' : 'series',
				imdbId: videoId,
				maxSizeGb,
			}),
	};
}
