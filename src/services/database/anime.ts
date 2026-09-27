import { Prisma } from '@prisma/client';
import { soundex } from '../../utils/soundex';
import { DatabaseClient } from './client';

interface AnimeItem {
	id: string;
	poster_url: string;
}

export interface AnimeSearchResult extends AnimeItem {
	title: string;
}

/** The id spaces an `Anime` row is addressed by from outside. */
export type AnimeIdSource = 'anidb' | 'mal' | 'kitsu';

export interface AnimeRecord {
	anidb_id: number | null;
	kitsu_id: number | null;
	mal_id: number | null;
	imdb_id: string | null;
	title: string;
	description: string;
	poster_url: string;
	background_url: string;
	rating: number;
}

export class AnimeService extends DatabaseClient {
	public async getRecentlyUpdatedAnime(limit: number): Promise<AnimeItem[]> {
		const results = await this.prisma.$queryRaw<any[]>`
    SELECT
      a.anidb_id,
      a.mal_id,
      a.poster_url,
      MAX(s.updatedAt) AS last_updated
    FROM Anime AS a
    JOIN ScrapedTrue AS s
    ON (a.mal_id = CAST(SUBSTRING(s.key, 11) AS UNSIGNED) AND SUBSTRING(s.key, 1, 9) = 'anime:mal')
    OR (a.anidb_id = CAST(SUBSTRING(s.key, 13) AS UNSIGNED) AND SUBSTRING(s.key, 1, 11) = 'anime:anidb')
    WHERE a.poster_url IS NOT NULL AND a.poster_url != ''
    GROUP BY a.anidb_id, a.mal_id, a.poster_url
    ORDER BY last_updated DESC
    LIMIT ${limit}`;
		return results.map((anime) => ({
			id: anime.anidb_id ? `anime:anidb-${anime.anidb_id}` : `anime:mal-${anime.mal_id}`,
			poster_url: anime.poster_url,
		}));
	}

	public async searchAnimeByTitle(query: string): Promise<AnimeSearchResult[]> {
		const soundexQuery = soundex(query);
		const results = await this.prisma.$queryRaw<any[]>`
    SELECT
      a.title,
      a.anidb_id,
      a.mal_id,
      a.poster_url
    FROM Anime AS a
    WHERE (SOUNDEX(a.title) = ${soundexQuery} OR a.title LIKE ${
		'%' + query.toLowerCase() + '%'
	}) AND a.poster_url IS NOT NULL AND a.poster_url != ''
    ORDER BY a.rating DESC`;
		return results.map((anime) => ({
			id: anime.anidb_id ? `anime:anidb-${anime.anidb_id}` : `anime:mal-${anime.mal_id}`,
			title: anime.title,
			poster_url: anime.poster_url,
		}));
	}

	public async getAnimeByMalIds(malIds: number[]): Promise<AnimeSearchResult[]> {
		const results = await this.prisma.anime.findMany({
			where: {
				mal_id: {
					in: malIds,
				},
				poster_url: {
					not: {
						equals: '',
					},
				},
			},
			select: {
				title: true,
				anidb_id: true,
				mal_id: true,
				poster_url: true,
			},
		});
		return results.map((anime) => ({
			id: anime.anidb_id ? `anime:anidb-${anime.anidb_id}` : `anime:mal-${anime.mal_id}`,
			title: anime.title,
			poster_url: anime.poster_url,
		}));
	}

	public async getAnimeByKitsuIds(kitsuIds: number[]): Promise<AnimeSearchResult[]> {
		const results = await this.prisma.anime.findMany({
			where: {
				kitsu_id: {
					in: kitsuIds,
				},
				poster_url: {
					not: {
						equals: '',
					},
				},
			},
			select: {
				title: true,
				anidb_id: true,
				mal_id: true,
				poster_url: true,
			},
		});
		return results.map((anime) => ({
			id: anime.anidb_id ? `anime:anidb-${anime.anidb_id}` : `anime:mal-${anime.mal_id}`,
			title: anime.title,
			poster_url: anime.poster_url,
		}));
	}

	/**
	 * One row by whichever external id the caller holds.
	 *
	 * Search hands out anidb ids (mal when a row has none) while the metadata
	 * upstreams are keyed by Kitsu, so the row is what translates between them.
	 * It also carries the IMDb id the Kitsu API lacks, and enough metadata to
	 * render a page when neither upstream answers.
	 */
	public async getAnimeByExternalId(
		source: AnimeIdSource,
		id: number
	): Promise<AnimeRecord | null> {
		const where: Prisma.AnimeWhereUniqueInput =
			source === 'anidb'
				? { anidb_id: id }
				: source === 'mal'
					? { mal_id: id }
					: { kitsu_id: id };
		return this.prisma.anime.findUnique({
			where,
			select: {
				anidb_id: true,
				kitsu_id: true,
				mal_id: true,
				imdb_id: true,
				title: true,
				description: true,
				poster_url: true,
				background_url: true,
				rating: true,
			},
		});
	}
}
