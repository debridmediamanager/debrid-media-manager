import { PrismaClient, Scraped } from '@prisma/client';
import { ScrapeSearchResult, flattenAndRemoveDuplicates, sortByFileSize } from './mediasearch';
import { MediaInfoDetails } from './realDebrid';

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
		console.log('updatedAt', updatedAt, 'dateXdaysAgo', dateXdaysAgo);
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
				userId_hash: {
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
			take: 10,
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
			.filter((value, index, self) => self.indexOf(value) === index) // Ensures uniqueness
			.slice(0, 10); // Takes the last 10 unique shows

		return uniqueShows;
	}
}
