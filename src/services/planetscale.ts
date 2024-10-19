import { PrismaClient, Scraped } from '@prisma/client';
import { ScrapeSearchResult, flattenAndRemoveDuplicates, sortByFileSize } from './mediasearch';
import { MediaInfoDetails } from './types';

export class PlanetScaleCache {
	private static instance: PrismaClient;
	public prisma: PrismaClient;

	constructor() {
		this.prisma = PlanetScaleCache.getInstance();
	}

	private static getInstance(): PrismaClient {
		if (!PlanetScaleCache.instance) {
			PlanetScaleCache.instance = new PrismaClient();
			PlanetScaleCache.instance.$queryRaw`SET @@boost_cached_queries = true`;
		}
		return PlanetScaleCache.instance;
	}

	/// true scraped

	public async saveScrapedTrueResults(
		key: string,
		value: ScrapeSearchResult[],
		updateUpdatedAt: boolean = true
	) {
		// Fetch the existing record
		const existingRecord: Scraped | null = await this.prisma.scrapedTrue.findUnique({
			where: { key },
		});

		if (existingRecord) {
			const origLength = (existingRecord.value as ScrapeSearchResult[]).length;
			// If record exists, append the new values to it
			let updatedValue = flattenAndRemoveDuplicates([
				existingRecord.value as ScrapeSearchResult[],
				value,
			]);

			updatedValue = updatedValue.filter((item) => item.hash.length === 40);
			// filter hashes that ends with aaaaa
			updatedValue = updatedValue.filter((item) => !item.hash.endsWith('aaaaa'));

			updatedValue = sortByFileSize(updatedValue);
			const newLength = updatedValue.length;
			console.log(`📝 ${key}: +${newLength - origLength} results`);

			await this.prisma.scrapedTrue.update({
				where: { key },
				data: {
					value: updatedValue,
					updatedAt: updateUpdatedAt ? undefined : existingRecord.updatedAt,
				},
			});
		} else {
			// If record doesn't exist, create a new one
			await this.prisma.scrapedTrue.create({
				data: { key, value },
			});
		}
	}

	public async getScrapedTrueResults<T>(key: string): Promise<T | undefined> {
		const cacheEntry = await this.prisma.scrapedTrue.findUnique({ where: { key } });
		return cacheEntry?.value as T | undefined;
	}

	public async deleteScrapedTrue(imdbId: string): Promise<void> {
		const keys = [`movie:${imdbId}`, `tv:${imdbId}%`];

		for (const key of keys) {
			await this.prisma.scrapedTrue.deleteMany({
				where: { key: { contains: key } },
			});
		}
	}

	/// scraped results

	public async saveScrapedResults(
		key: string,
		value: ScrapeSearchResult[],
		updateUpdatedAt: boolean = true,
		replaceOldScrape: boolean = false
	) {
		// Fetch the existing record
		const existingRecord: Scraped | null = await this.prisma.scraped.findUnique({
			where: { key },
		});

		if (existingRecord && !replaceOldScrape) {
			const origLength = (existingRecord.value as ScrapeSearchResult[]).length;
			// If record exists, append the new values to it
			let updatedValue = flattenAndRemoveDuplicates([
				existingRecord.value as ScrapeSearchResult[],
				value,
			]);
			updatedValue = sortByFileSize(updatedValue);
			const newLength = updatedValue.length;
			console.log(`📝 ${key}: +${newLength - origLength} results`);

			await this.prisma.scraped.update({
				where: { key },
				data: {
					value: updatedValue,
					updatedAt: updateUpdatedAt ? undefined : existingRecord.updatedAt,
				},
			});
		} else if (existingRecord && replaceOldScrape) {
			await this.prisma.scraped.update({
				where: { key },
				data: {
					value,
					updatedAt: updateUpdatedAt ? undefined : existingRecord.updatedAt,
				},
			});
		} else {
			// If record doesn't exist, create a new one
			await this.prisma.scraped.create({
				data: { key, value },
			});
		}
	}

	public async getScrapedResults<T>(key: string): Promise<T | undefined> {
		const cacheEntry = await this.prisma.scraped.findUnique({ where: { key } });
		return cacheEntry?.value as T | undefined;
	}

	public async keyExists(key: string): Promise<boolean> {
		const cacheEntry = await this.prisma.scraped.findFirst({
			where: { key },
			select: { key: true },
		});
		return cacheEntry !== null;
	}

	public async isOlderThan(imdbId: string, daysAgo: number): Promise<boolean> {
		const cacheEntry = await this.prisma.scraped.findFirst({
			where: {
				OR: [
					{ key: { startsWith: `movie:${imdbId}` } },
					{ key: { startsWith: `tv:${imdbId}` } },
				],
			},
			select: { updatedAt: true },
		});
		if (!cacheEntry || !cacheEntry.updatedAt) {
			return true; // If it doesn't exist, assume it's old
		}
		const updatedAt = cacheEntry.updatedAt;
		const currentTime = Date.now();
		const millisAgo = daysAgo * 24 * 60 * 60 * 1000;
		const dateXdaysAgo = new Date(currentTime - millisAgo);
		return updatedAt <= dateXdaysAgo;
	}

	public async getOldestRequest(
		olderThan: Date | null = null
	): Promise<{ key: string; updatedAt: Date } | null> {
		const whereCondition: any = {
			key: { startsWith: 'requested:tt' },
		};

		if (olderThan !== null) {
			whereCondition.updatedAt = { gt: olderThan };
		}

		const requestedItem = await this.prisma.scraped.findFirst({
			where: whereCondition,
			orderBy: { updatedAt: 'asc' },
			select: { key: true, updatedAt: true },
		});

		if (requestedItem !== null) {
			return {
				key: requestedItem.key.split(':')[1],
				updatedAt: requestedItem.updatedAt,
			};
		}

		return null;
	}

	public async processingMoreThanAnHour(): Promise<string | null> {
		const oneHourAgo = new Date();
		oneHourAgo.setHours(oneHourAgo.getHours() - 1);

		const requestedItem = await this.prisma.scraped.findFirst({
			where: {
				key: { startsWith: 'processing:tt' },
				updatedAt: { lte: oneHourAgo },
			},
			orderBy: { updatedAt: 'asc' },
			select: { key: true },
		});

		if (requestedItem !== null) {
			await this.prisma.scraped.update({
				where: { key: requestedItem.key },
				data: { updatedAt: new Date() },
			});

			return requestedItem.key.split(':')[1];
		}

		return null;
	}

	public async getOldestScrapedMedia(
		mediaType: 'tv' | 'movie',
		quantity = 3
	): Promise<string[] | null> {
		const scrapedItems = await this.prisma.scraped.findMany({
			where: {
				key: { startsWith: `${mediaType}:tt` },
			},
			orderBy: { updatedAt: 'asc' },
			take: quantity,
			select: { key: true },
		});

		if (scrapedItems.length > 0) {
			return scrapedItems.map((item) => item.key.split(':')[1]);
		}

		return null;
	}

	public async getAllImdbIds(mediaType: 'tv' | 'movie'): Promise<string[] | null> {
		const scrapedItems = await this.prisma.scraped.findMany({
			where: {
				key: { startsWith: `${mediaType}:tt` },
			},
			orderBy: { updatedAt: 'asc' },
			select: { key: true },
		});

		if (scrapedItems.length > 0) {
			// ensure unique imdbIds
			return Array.from(new Set(scrapedItems.map((item) => item.key.split(':')[1])));
		}

		return null;
	}

	public async delete(imdbId: string): Promise<void> {
		const keys = [`movie:${imdbId}`, `tv:${imdbId}%`];

		for (const key of keys) {
			await this.prisma.scraped.deleteMany({
				where: { key: { contains: key } },
			});
		}
	}

	public async markAsDone(imdbId: string): Promise<void> {
		const keys = [`requested:${imdbId}`, `processing:${imdbId}`];

		for (const key of keys) {
			await this.prisma.scraped.deleteMany({
				where: { key },
			});
		}
	}

	// search results

	public async saveSearchResults<T>(key: string, value: T) {
		await this.prisma.search.upsert({
			where: { key },
			update: { value } as any,
			create: { key, value } as any,
		});
	}

	public async getSearchResults<T>(key: string): Promise<T | undefined> {
		const cacheEntry = await this.prisma.search.findUnique({ where: { key } });

		if (cacheEntry) {
			const updatedAt = cacheEntry.updatedAt;
			const now = new Date();
			const differenceInHours =
				Math.abs(now.getTime() - updatedAt.getTime()) / 1000 / 60 / 60;

			if (differenceInHours > 24) {
				return undefined;
			} else {
				return cacheEntry.value as T;
			}
		}

		return undefined;
	}

	public async getRecentlyUpdatedContent(): Promise<string[]> {
		const rows = await this.prisma.scraped.findMany({
			take: 200,
			orderBy: {
				updatedAt: 'desc',
			},
			where: {
				OR: [{ key: { startsWith: 'movie:tt' } }, { key: { startsWith: 'tv:tt' } }],
			},
			select: {
				key: true,
			},
		});

		return rows
			.map((row: any) => {
				const match = row.key.match(/^(movie|tv):([^:]+)/);
				if (match) {
					return `${match[1]}:${match[2]}`;
				}
				return '';
			})
			.filter((key: any) => key !== '');
	}

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
			poster_url: `https://media.kitsu.app/anime/poster_images/${anime.anidb_id}/medium.jpg`,
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
			poster_url: `https://media.kitsu.app/anime/poster_images/${anime.anidb_id}/medium.jpg`,
		}));
	}

	// get anime by list of mal id
	public async getAnimeByMalIds(malIds: number[]): Promise<AnimeSearchResult[]> {
		const results = await this.prisma.anime.findMany({
			where: {
				kitsu_id: {
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
			poster_url: `https://media.kitsu.app/anime/poster_images/${anime.anidb_id}/medium.jpg`,
		}));
	}

	// get anime by list of kitsu id
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
			poster_url: `https://media.kitsu.app/anime/poster_images/${anime.anidb_id}/medium.jpg`,
		}));
	}

	public async getEmptyMedia(quantity = 3): Promise<string[] | null> {
		const scrapedItems = await this.prisma.scraped.findMany({
			where: {
				OR: [
					{
						key: { startsWith: `tv:tt` },
						value: { equals: [] },
					},
					{
						key: { startsWith: `movie:tt` },
						value: { equals: [] },
					},
				],
			},
			orderBy: { updatedAt: 'asc' },
			take: quantity,
			select: { key: true },
		});

		if (scrapedItems.length > 0) {
			return scrapedItems.map((item) => item.key.split(':')[1]);
		}

		return null;
	}

	public async getLatestCast(imdbId: string, userId: string): Promise<string | null> {
		const castItem = await this.prisma.cast.findFirst({
			where: {
				imdbId: imdbId,
				userId: userId,
			},
			orderBy: {
				updatedAt: 'desc',
			},
			select: {
				url: true,
			},
		});
		return castItem?.url ?? null;
	}

	public async getCastURLs(
		imdbId: string,
		userId: string
	): Promise<{ url: string; size: number }[]> {
		const castItems = await this.prisma.cast.findMany({
			where: {
				imdbId: imdbId,
				userId: userId,
				updatedAt: {
					gt: new Date(new Date().getTime() - 90 * 24 * 60 * 60 * 1000), // 90 days
				},
			},
			orderBy: {
				updatedAt: 'desc',
			},
			select: {
				url: true,
				size: true,
			},
		});
		return castItems.map((item) => ({
			url: item.url,
			size: item.size,
		}));
	}

	public async saveCast(
		imdbId: string,
		userId: string,
		hash: string,
		url: string,
		duration: number,
		bitrate: number,
		fileSize: number,
		mediaInfo: MediaInfoDetails | null
	): Promise<void> {
		const mediaInfo2 = mediaInfo as any;
		await this.prisma.cast.upsert({
			where: {
				imdbId_userId_hash: {
					imdbId: imdbId,
					userId: userId,
					hash: hash,
				},
			},
			update: {
				imdbId: imdbId,
				url: url,
				duration: duration,
				bitrate: bitrate,
				size: fileSize,
				mediaInfo: mediaInfo2,
			},
			create: {
				imdbId: imdbId,
				userId: userId,
				hash: hash,
				url: url,
				duration: duration,
				bitrate: bitrate,
				size: fileSize,
				mediaInfo: mediaInfo2,
			},
		});
	}

	public async fetchCastedMovies(userId: string): Promise<string[]> {
		const movies = await this.prisma.cast.findMany({
			where: {
				userId: userId,
				imdbId: {
					not: {
						contains: ':', // Excludes shows
					},
				},
			},
			orderBy: {
				updatedAt: 'desc',
			},
			distinct: ['imdbId'],
			// take: 48,
			select: {
				imdbId: true,
			},
		});

		return movies.map((movie) => movie.imdbId);
	}

	public async fetchCastedShows(userId: string): Promise<string[]> {
		const showsWithDuplicates = await this.prisma.cast.findMany({
			where: {
				userId: userId,
				imdbId: {
					contains: ':', // Includes only shows
				},
			},
			orderBy: {
				updatedAt: 'desc',
			},
			select: {
				imdbId: true,
			},
		});

		const uniqueShows = showsWithDuplicates
			.map((show) => show.imdbId.split(':')[0]) // Extracts the base imdbId of the show
			.filter((value, index, self) => self.indexOf(value) === index); // Ensures uniqueness
		// .slice(0, 48); // Takes the last 48 unique shows

		return uniqueShows;
	}
}

// Function to generate the MySQL SOUNDEX value in JavaScript
function soundex(query: string): string {
	if (!query || query.length === 0) {
		return '0000';
	}

	const upperQuery = query.toUpperCase();
	const firstLetter = upperQuery.charAt(0).replace(/[^A-Z]/g, '');
	const rest = upperQuery.slice(1).replace(/[^A-Z]/g, '');

	let encoded =
		firstLetter +
		rest
			.replace(/[AEIOUYHW]/g, '0')
			.replace(/[BFPV]/g, '1')
			.replace(/[CGJKQSXZ]/g, '2')
			.replace(/[DT]/g, '3')
			.replace(/[L]/g, '4')
			.replace(/[MN]/g, '5')
			.replace(/[R]/g, '6');

	// Remove duplicates
	encoded = encoded.charAt(0) + encoded.slice(1).replace(/(.)\1+/g, '$1');

	// Remove all 0s and pad to ensure length is 4
	encoded = encoded.replace(/0/g, '').padEnd(4, '0').slice(0, 4);

	return encoded;
}
