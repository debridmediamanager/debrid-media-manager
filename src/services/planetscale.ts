import { PrismaClient, Scraped } from '@prisma/client';
import { ScrapeSearchResult, flattenAndRemoveDuplicates, sortByFileSize } from './mediasearch';

export class PlanetScaleCache {
	public prisma: PrismaClient;

	constructor() {
		this.prisma = new PrismaClient();
		this.prisma.$queryRaw`SET @@boost_cached_queries = true`;
	}

	/// scraped results

	public async saveScrapedResults(
		key: string,
		value: ScrapeSearchResult[],
		updateUpdatedAt: boolean = true
	) {
		// Fetch the existing record
		const existingRecord: Scraped | null = await this.prisma.scraped.findUnique({
			where: { key },
		});

		if (existingRecord) {
			// If record exists, append the new values to it
			let updatedValue = flattenAndRemoveDuplicates([
				existingRecord.value as ScrapeSearchResult[],
				value,
			]);
			updatedValue = sortByFileSize(updatedValue);

			await this.prisma.scraped.update({
				where: { key },
				data: {
					value: updatedValue,
					updatedAt: updateUpdatedAt ? undefined : existingRecord.updatedAt, // If updateUpdatedAt is false, keep the old updatedAt value
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

		const currentTime = new Date();
		const updatedAt = new Date(cacheEntry.updatedAt);
		const ageInMillis = currentTime.getTime() - updatedAt.getTime();
		const daysAgoInMillis = daysAgo * 24 * 60 * 60 * 1000;
		return ageInMillis >= daysAgoInMillis;
	}

	public async getOldestRequest(
		olderThan: Date | null = null
	): Promise<{ key: string; updatedAt: Date } | null> {
		const whereCondition: any = {
			key: { startsWith: 'requested:' },
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
				key: { startsWith: 'processing:' },
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
				key: { startsWith: `${mediaType}:` },
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
				key: { startsWith: `${mediaType}:` },
			},
			orderBy: { updatedAt: 'asc' },
			select: { key: true },
		});

		if (scrapedItems.length > 0) {
			return scrapedItems.map((item) => item.key.split(':')[1]);
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
				OR: [{ key: { startsWith: 'movie:' } }, { key: { startsWith: 'tv:' } }],
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
}
