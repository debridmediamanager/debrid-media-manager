import { PrismaClient } from '@prisma/client';

export class PlanetScaleCache {
	public prisma: PrismaClient;

	constructor() {
		this.prisma = new PrismaClient();
		this.prisma.$queryRaw`SET @@boost_cached_queries = true`;
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

	public async keyExists(key: string): Promise<boolean> {
		const cacheEntry = await this.prisma.scraped.findFirst({
			where: { key },
			select: { key: true },
		});
		return cacheEntry !== null;
	}

	public async getOldestRequest(): Promise<string | null> {
		const requestedItem = await this.prisma.scraped.findFirst({
			where: { key: { startsWith: 'requested:' } },
			orderBy: { updatedAt: 'asc' },
			select: { key: true },
		});
		if (requestedItem !== null) {
			return requestedItem.key.split(':')[1];
		}
		return null;
	}

	public async getOldestProcessing(): Promise<string | null> {
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
			return requestedItem.key.split(':')[1];
		}

		return null;
	}

	public async getOldestScrapedMedia(mediaType: 'tv' | 'movie'): Promise<string | null> {
		const oneDayAgo = new Date();
		oneDayAgo.setHours(oneDayAgo.getHours() - 24);

		const scrapedItem = await this.prisma.scraped.findFirst({
			where: {
				key: { startsWith: `${mediaType}:` },
				updatedAt: { lte: oneDayAgo },
			},
			orderBy: { updatedAt: 'asc' },
			select: { key: true },
		});

		if (scrapedItem !== null) {
			const splits = scrapedItem.key.split(':');
			if (splits.length === 3 && splits[2] !== '1') return null;
			return splits[1];
		}

		return null;
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
}
