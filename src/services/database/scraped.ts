import { Prisma, Scraped } from '@prisma/client';
import { ScrapeSearchResult, flattenAndRemoveDuplicates, sortByFileSize } from '../mediasearch';
import { DatabaseClient } from './client';

export class ScrapedService extends DatabaseClient {
	public async getScrapedTrueResults<T>(
		key: string,
		maxSizeGB?: number,
		page: number = 0
	): Promise<T | undefined> {
		// Input Validation
		if (!key || typeof key !== 'string') {
			throw new Error('Invalid key provided.');
		}

		const maxSizeMB = maxSizeGB && maxSizeGB > 0 ? maxSizeGB * 1024 : null;
		const offset = page * 50;

		let query = Prisma.sql`
      SELECT
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'hash', jt.hash,
            'title', jt.title,
            'fileSize', jt.fileSize
          )
        ) AS value
      FROM (
        SELECT
          jt.hash,
          jt.title,
          jt.fileSize
        FROM
          ScrapedTrue s
        JOIN
          JSON_TABLE(
            s.value,
            '$[*]'
            COLUMNS (
              hash VARCHAR(255) PATH '$.hash',
              title VARCHAR(255) PATH '$.title',
              fileSize DECIMAL(10,2) PATH '$.fileSize'
            )
          ) AS jt
        WHERE
          s.key = ${key}
        ${maxSizeMB ? Prisma.sql`AND jt.fileSize <= ${maxSizeMB}` : Prisma.empty}
        ORDER BY jt.fileSize DESC
        LIMIT 50
        OFFSET ${offset}
      ) AS jt`;

		try {
			const result = await this.prisma.$queryRaw<{ value: T }[]>(query);
			return result.length > 0 ? result[0].value : undefined;
		} catch (error) {
			console.error(
				'Database query failed:',
				error instanceof Error ? error.message : 'Unknown error'
			);
			throw new Error('Failed to retrieve scrapedtrue results.');
		}
	}

	public async getScrapedResults<T>(
		key: string,
		maxSizeGB?: number,
		page: number = 0
	): Promise<T | undefined> {
		// Input Validation
		if (!key || typeof key !== 'string') {
			throw new Error('Invalid key provided.');
		}
		if (maxSizeGB !== undefined && (typeof maxSizeGB !== 'number' || maxSizeGB < 0)) {
			throw new Error('maxSizeGB must be a positive number.');
		}

		const maxSizeMB = maxSizeGB ? maxSizeGB * 1024 : null;
		const offset = page * 50;

		let query = Prisma.sql`
      SELECT
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'hash', jt.hash,
            'title', jt.title,
            'fileSize', jt.fileSize
          )
        ) AS value
      FROM (
        SELECT
          jt.hash,
          jt.title,
          jt.fileSize
        FROM
          Scraped s
        JOIN
          JSON_TABLE(
            s.value,
            '$[*]'
            COLUMNS (
              hash VARCHAR(255) PATH '$.hash',
              title VARCHAR(255) PATH '$.title',
              fileSize DECIMAL(10,2) PATH '$.fileSize'
            )
          ) AS jt
        WHERE
          s.key = ${key}
        ${maxSizeMB ? Prisma.sql`AND jt.fileSize <= ${maxSizeMB}` : Prisma.empty}
        ORDER BY jt.fileSize DESC
        LIMIT 50
        OFFSET ${offset}
      ) AS jt`;

		try {
			const result = await this.prisma.$queryRaw<{ value: T }[]>(query);
			return result.length > 0 ? result[0].value : undefined;
		} catch (error) {
			console.error(
				'Database query failed:',
				error instanceof Error ? error.message : 'Unknown error'
			);
			throw new Error('Failed to retrieve scraped results.');
		}
	}

	public async saveScrapedTrueResults(
		key: string,
		value: ScrapeSearchResult[],
		updateUpdatedAt: boolean = true,
		replaceOldScrape: boolean = false
	) {
		// Fetch the existing record
		const existingRecord: Scraped | null = await this.prisma.scrapedTrue.findUnique({
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
			// Log update count without exposing the key
			console.log(`📝 Updated: +${newLength - origLength} results`);

			await this.prisma.scrapedTrue.update({
				where: { key },
				data: {
					value: updatedValue,
					updatedAt: updateUpdatedAt ? new Date() : existingRecord.updatedAt,
				},
			});
		} else if (existingRecord && replaceOldScrape) {
			await this.prisma.scrapedTrue.update({
				where: { key },
				data: {
					value,
					updatedAt: updateUpdatedAt ? new Date() : existingRecord.updatedAt,
				},
			});
		} else {
			await this.prisma.scrapedTrue.create({
				data: { key, value },
			});
		}
	}

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
			// Log update count without exposing the key
			console.log(`📝 Updated: +${newLength - origLength} results`);

			await this.prisma.scraped.update({
				where: { key },
				data: {
					value: updatedValue,
					updatedAt: updateUpdatedAt ? new Date() : existingRecord.updatedAt,
				},
			});
		} else if (existingRecord && replaceOldScrape) {
			await this.prisma.scraped.update({
				where: { key },
				data: {
					value,
					updatedAt: updateUpdatedAt ? new Date() : existingRecord.updatedAt,
				},
			});
		} else {
			await this.prisma.scraped.create({
				data: { key, value },
			});
		}
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

	public async markAsDone(imdbId: string): Promise<void> {
		const keys = [`requested:${imdbId}`, `processing:${imdbId}`];

		for (const key of keys) {
			await this.prisma.scraped.deleteMany({
				where: { key },
			});
		}
	}

	public async getRecentlyUpdatedContent(): Promise<string[]> {
		const [scrapedRows, scrapedTrueRows] = await Promise.all([
			this.prisma.scraped.findMany({
				take: 100,
				orderBy: {
					updatedAt: 'desc',
				},
				where: {
					OR: [{ key: { startsWith: 'movie:tt' } }, { key: { startsWith: 'tv:tt' } }],
				},
				select: {
					key: true,
					updatedAt: true,
				},
			}),
			this.prisma.scrapedTrue.findMany({
				take: 100,
				orderBy: {
					updatedAt: 'desc',
				},
				where: {
					OR: [{ key: { startsWith: 'movie:tt' } }, { key: { startsWith: 'tv:tt' } }],
				},
				select: {
					key: true,
					updatedAt: true,
				},
			}),
		]);

		// Combine and sort by updatedAt
		const allRows = [...scrapedRows, ...scrapedTrueRows]
			.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
			.slice(0, 200);

		return allRows
			.map((row: any) => {
				const match = row.key.match(/^(movie|tv):([^:]+)/);
				if (match) {
					return `${match[1]}:${match[2]}`;
				}
				return '';
			})
			.filter((key: any) => key !== '');
	}

	public async getContentSize(): Promise<number> {
		const result = await this.prisma.$queryRaw<[{ contentSize: number }]>`
      SELECT count(*) as contentSize
      FROM Scraped
      WHERE Scraped.key LIKE 'movie:%' OR Scraped.key LIKE 'tv:%';
    `;
		return parseInt(result[0].contentSize.toString());
	}

	public async getProcessingCount(): Promise<number> {
		const result = await this.prisma.$queryRaw<[{ processing: number }]>`
      SELECT count(*) as processing
      FROM Scraped
      WHERE Scraped.key LIKE 'processing:%';
    `;
		return parseInt(result[0].processing.toString());
	}

	public async getRequestedCount(): Promise<number> {
		const result = await this.prisma.$queryRaw<[{ requested: number }]>`
      SELECT count(*) as requested
      FROM Scraped
      WHERE Scraped.key LIKE 'requested:%';
    `;
		return parseInt(result[0].requested.toString());
	}
}
