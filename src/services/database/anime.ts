import { soundex } from '../../utils/soundex';
import { DatabaseClient } from './client';

interface AnimeItem {
	id: string;
	poster_url: string;
}

interface AnimeSearchResult extends AnimeItem {
	title: string;
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
}
