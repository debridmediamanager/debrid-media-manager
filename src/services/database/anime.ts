import { Prisma } from '@prisma/client';
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
	/**
	 * Rows for a search's Kitsu ids, in the order the search ranked them.
	 *
	 * `IN (...)` hands rows back in whatever order the index scan finds them,
	 * which is kitsu_id order in production: a "Fate/Zero" search came back
	 * with Gravitation (kitsu 218) ahead of Fate/Zero (6028).
	 */
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
				kitsu_id: true,
				poster_url: true,
			},
		});
		const rank = new Map(kitsuIds.map((id, index) => [id, index]));
		const position = (kitsuId: number | null) =>
			(kitsuId !== null ? rank.get(kitsuId) : undefined) ?? kitsuIds.length;
		return results
			.sort((a, b) => position(a.kitsu_id) - position(b.kitsu_id))
			.map((anime) => ({
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
