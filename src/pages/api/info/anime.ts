import { fetchAniListAnime } from '@/services/anime/anilist';
import { getFranchiseIndex } from '@/services/anime/animeFranchise';
import { fetchKitsuAnime } from '@/services/anime/kitsu';
import { resolveImdbIdFromSimkl } from '@/services/anime/simkl';
import type { AnimeIdSource, AnimeRecord } from '@/services/database/anime';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';
import UserAgent from 'user-agents';

const getAnimeInfo = (id: string) => `https://anime-kitsu.strem.fun/meta/series/${id}.json`;

interface AnimeInfoResponse {
	title: string;
	description: string;
	poster: string;
	backdrop: string;
	imdbid: string;
	imdbRating: number;
	/** TV, OVA, ONA, MOVIE, SPECIAL or UNKNOWN; '' when no source says. */
	type: string;
	/** Episodes the entry has, when Kitsu lists a count; 0 otherwise. */
	episodeCount: number;
}

const UNKNOWN: AnimeInfoResponse = {
	title: 'Unknown',
	description: 'Unknown',
	// No art: say so, as /api/info/show and /api/info/movie do, and let the page
	// draw its own. picsum.photos/200/300 was a random stock photo on every load.
	poster: '',
	backdrop: '',
	imdbid: '',
	imdbRating: 0,
	type: '',
	episodeCount: 0,
};

interface AnimeId {
	source: AnimeIdSource;
	id: number;
}

/**
 * Every spelling of an anime id that reaches this route.
 *
 * `/api/search/anime` hands out `anime:anidb-N`, or `anime:mal-N` for a row
 * without an anidb id, and the anime page it used to link to dropped the
 * `anime:` prefix. Kitsu ids arrive as `kitsu-N`, `kitsu:N` or a bare number.
 * This route used to accept only the Kitsu forms, so every search hit rendered
 * as the "Unknown" placeholder.
 */
function parseAnimeId(animeid: string): AnimeId | null {
	const match = /^(?:anime:)?(?:(anidb|mal|kitsu)[-:])?(\d+)$/i.exec(animeid.trim());
	if (!match) return null;
	const id = parseInt(match[2], 10);
	if (!Number.isSafeInteger(id) || id <= 0) return null;
	return { source: (match[1]?.toLowerCase() as AnimeIdSource | undefined) ?? 'kitsu', id };
}

async function fromStremioAddon(kitsuId: number): Promise<AnimeInfoResponse | null> {
	try {
		const animeurl = getAnimeInfo(`kitsu%3A${kitsuId}`);
		const response = await axios.get(animeurl, {
			headers: {
				accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
				'accept-language': 'en-US,en;q=0.5',
				'accept-encoding': 'gzip, deflate, br',
				connection: 'keep-alive',
				'sec-fetch-dest': 'document',
				'sec-fetch-mode': 'navigate',
				'sec-fetch-site': 'same-origin',
				'sec-fetch-user': '?1',
				'upgrade-insecure-requests': '1',
				'user-agent': new UserAgent().toString(),
			},
		});

		const meta = response.data?.meta;
		if (!meta?.name) return null;

		return {
			title: meta.name,
			description: meta.description ?? '',
			poster: meta.poster ?? '',
			backdrop: meta.background ?? '',
			imdbid: meta.imdb_id ?? '',
			imdbRating: parseFloat(meta.imdbRating ?? '0'),
			type: '',
			episodeCount: 0,
		};
	} catch {
		return null;
	}
}

/**
 * The addon is community-run and has no SLA. Kitsu publishes the same
 * catalogue, so its outage costs the rating's provenance rather than the whole
 * page. Kitsu carries no IMDb id; resolveImdbId supplies one.
 */
async function fromKitsu(kitsuId: number): Promise<AnimeInfoResponse | null> {
	const meta = await fetchKitsuAnime(kitsuId);
	if (!meta) return null;

	return {
		title: meta.title,
		description: meta.description,
		poster: meta.poster,
		backdrop: meta.backdrop,
		imdbid: '',
		imdbRating: meta.rating,
		type: meta.type,
		episodeCount: meta.episodeCount,
	};
}

/**
 * AniList, for an entry Kitsu has no record of: Kitsu maps a new season late or
 * never, and 19795, 19847, 19889, 20245 and 18897 all had stored releases and
 * no Kitsu id on 2026-10-04. AniList is asked by its own id when the dataset
 * names one, otherwise by MAL's.
 */
async function fromAniList(
	anilistId: number | null,
	malId: number | null
): Promise<AnimeInfoResponse | null> {
	const meta = await fetchAniListAnime({ anilistId, malId });
	if (!meta) return null;

	return {
		title: meta.title,
		description: meta.description,
		poster: meta.poster,
		backdrop: meta.backdrop,
		imdbid: '',
		imdbRating: meta.rating,
		type: meta.type,
		episodeCount: meta.episodeCount,
	};
}

/**
 * The row already holds everything a page needs, so a Kitsu outage costs the
 * freshness of the metadata rather than the page. `rating` is the row's own
 * score on the same 0-10 scale, standing in exactly as Kitsu's does.
 */
function fromRow(row: AnimeRecord): AnimeInfoResponse {
	return {
		title: row.title,
		description: row.description,
		poster: row.poster_url,
		backdrop: row.background_url,
		imdbid: row.imdb_id ?? '',
		imdbRating: row.rating,
		type: row.type ?? '',
		episodeCount: 0,
	};
}

async function findRow(animeId: AnimeId): Promise<AnimeRecord | null> {
	try {
		return await db.getAnimeByExternalId(animeId.source, animeId.id);
	} catch {
		// A database outage should not stop a Kitsu id from resolving.
		return null;
	}
}

/**
 * Every other DMM surface is keyed by IMDb id, so a page without one is a dead
 * end. The row answers first because it costs no round trip; Simkl is asked
 * only for the rows it still has no id for, in the id space the caller used,
 * and no-ops when unconfigured.
 */
async function resolveImdbId(animeId: AnimeId, row: AnimeRecord | null): Promise<string> {
	if (row?.imdb_id) return row.imdb_id;
	return (await resolveImdbIdFromSimkl(animeId.source, animeId.id)) ?? '';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { animeid } = req.query;

	if (!animeid || typeof animeid !== 'string') {
		return res.status(400).json({ error: 'Anime ID is required' });
	}

	const animeId = parseAnimeId(animeid);
	if (!animeId) {
		return res.status(400).json({ error: 'Anime ID must be an anidb, mal or kitsu id' });
	}

	// Both upstreams are keyed by Kitsu; the row translates anidb and mal ids.
	const row = await findRow(animeId);
	// The Fribb dataset the anime page reads for relations. Of the 211 AniDB ids
	// with torrents and no row on 2026-09-27, it gave 128 a Kitsu id; it also
	// carries a type that is refreshed daily.
	const datasetEntry =
		animeId.source === 'anidb'
			? ((await getFranchiseIndex())?.byAnidb.get(animeId.id) ?? null)
			: null;
	const kitsuId =
		animeId.source === 'kitsu' ? animeId.id : (row?.kitsu_id ?? datasetEntry?.kitsuId ?? null);

	let info: AnimeInfoResponse | null = null;
	if (kitsuId !== null) {
		info = (await fromStremioAddon(kitsuId)) ?? (await fromKitsu(kitsuId));
	}
	// A row missing its title or poster is one the daily import could not fill
	// from Kitsu either; AniList may still have the entry.
	if (!info && row?.title && row.poster_url) info = fromRow(row);
	if (!info) {
		const malId =
			row?.mal_id ?? datasetEntry?.malId ?? (animeId.source === 'mal' ? animeId.id : null);
		info = await fromAniList(datasetEntry?.anilistId ?? null, malId);
	}
	if (!info && row) info = fromRow(row);
	if (!info) return res.status(200).json(UNKNOWN);

	if (!info.imdbid) info.imdbid = await resolveImdbId(animeId, row);
	// Of the 8,451 rows with torrents, 38 disagree with the dataset on type,
	// all older imports: Bookworm's fourth season (18302) is a 24-episode TV
	// season the row calls a SPECIAL. Kitsu's subtype is the last resort.
	info.type = datasetEntry?.type || row?.type || info.type;

	return res.status(200).json(info);
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.anime);
