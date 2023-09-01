import { PrismaClient } from '@prisma/client';

export class PlanetScaleCache {
	public prisma: PrismaClient;

	constructor() {
		this.prisma = new PrismaClient();
		this.prisma.$queryRaw`SET @@boost_cached_queries = true`;
	}

	public async cacheJsonValue<T>(key: string[], value: T) {
		const sortedKey = key.sort();
		const planetScaleKey = sortedKey.join(':');

		await this.prisma.cache.upsert({
			where: { key: planetScaleKey },
			update: { value } as any,
			create: { key: planetScaleKey, value } as any,
		});
	}

	public async getCachedJsonValue<T>(key: string[]): Promise<T | undefined> {
		const sortedKey = key.sort();
		const planetScaleKey = sortedKey.join(':');

		const cacheEntry = await this.prisma.cache.findUnique({ where: { key: planetScaleKey } });
		return cacheEntry?.value as T | undefined;
	}

	public async deleteCachedJsonValue(key: string[]): Promise<void> {
		const sortedKey = key.sort();
		const planetScaleKey = sortedKey.join(':');

		await this.prisma.cache.delete({ where: { key: planetScaleKey } });
	}

	public async getDbSize(): Promise<number> {
		const count = await this.prisma.cache.count();
		return count;
	}

	/// scraped results

	public async saveScrapedResults<T>(key: string, value: T) {
		await this.prisma.scraped.upsert({
			where: { key },
			update: { value } as any,
			create: { key, value } as any,
		});
	}

	public async getScrapedResults<T>(key: string): Promise<T | undefined> {
		const cacheEntry = await this.prisma.scraped.findUnique({ where: { key } });
		return cacheEntry?.value as T | undefined;
	}

	public async getScrapedDbSize(): Promise<number> {
		const count = await this.prisma.scraped.count();
		return count;
	}

	public async keyExists(key: string): Promise<boolean> {
		const cacheEntry = await this.prisma.scraped.findFirst({
			where: { key },
			select: { key: true },
		});
		return cacheEntry !== null;
	}

	public async getLatestRequest(): Promise<string | null> {
		const requestedItem = await this.prisma.scraped.findFirst({
			where: { key: { startsWith: "requested:" } },
			orderBy: { updatedAt: 'desc' },
			select: { key: true },
		});
		if (requestedItem !== null) {
			const imdbid = requestedItem.key.split(':')[1];
			// Check if there is a processing item for this imdbid
			const processingItem = await this.prisma.scraped.findFirst({
				where: { key: `processing:${imdbid}` },
			});
			if (!processingItem) {
				return imdbid;
			}
		}
		return null;
	}

	public async getOldestProcessing(): Promise<string | null> {
		const requestedItem = await this.prisma.scraped.findFirst({
			where: { key: { startsWith: "processing:" } },
			orderBy: { updatedAt: 'asc' },
			select: { key: true },
		});
		console.log(requestedItem);
		if (requestedItem !== null) {
			return requestedItem.key.split(':')[1];
		}
		return null;
	}

	public async markAsDone(imdbId: string): Promise<void> {
		const keys = [`requested:${imdbId}`, `processing:${imdbId}`];

		for (const key of keys) {
			await this.prisma.scraped.deleteMany({
				where: { key: { startsWith: key }  },
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
}
