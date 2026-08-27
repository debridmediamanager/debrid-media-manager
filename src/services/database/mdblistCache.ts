import { Prisma } from '@prisma/client';
import { MList, MMovie, MSearchResponse, MShow } from '../mdblist';
import { DatabaseClient } from './client';

const TITLE_LOOKUP_CHUNK = 1000;

export class MdblistCacheService extends DatabaseClient {
	/**
	 * Get cached MDBList data by ID
	 */
	async get(id: string): Promise<any | null> {
		try {
			const cached = await this.prisma.mdblistCache.findUnique({
				where: { id },
			});

			if (cached) {
				return cached.data;
			}

			return null;
		} catch (error) {
			console.error('Error getting MDBList cache:', error);
			return null;
		}
	}

	/**
	 * Get cached data with metadata including updatedAt timestamp
	 */
	async getWithMetadata(id: string): Promise<{ data: any; updatedAt: Date } | null> {
		try {
			const cached = await this.prisma.mdblistCache.findUnique({
				where: { id },
			});

			if (cached) {
				return {
					data: cached.data,
					updatedAt: cached.updatedAt,
				};
			}

			return null;
		} catch (error) {
			console.error('Error getting MDBList cache with metadata:', error);
			return null;
		}
	}

	/**
	 * Save MDBList data to cache
	 */
	async set(id: string, type: string, data: any): Promise<void> {
		try {
			await this.prisma.mdblistCache.upsert({
				where: { id },
				update: {
					data,
					type,
				},
				create: {
					id,
					type,
					data,
				},
			});
		} catch (error) {
			console.error('Error setting MDBList cache:', error);
		}
	}

	/**
	 * Titles for many ids in one query. Ids with no cached entry are absent from
	 * the map — callers decide what to show instead.
	 */
	async getTitles(ids: string[]): Promise<Map<string, string>> {
		const titles = new Map<string, string>();
		if (ids.length === 0) {
			return titles;
		}

		try {
			// Read the title out in SQL. Selecting the cached payload to pick one
			// field off it pulls ~45MB for the largest casted catalog, which turned
			// a 1.4s catalog into a 20s one.
			for (let i = 0; i < ids.length; i += TITLE_LOOKUP_CHUNK) {
				const chunk = ids.slice(i, i + TITLE_LOOKUP_CHUNK);
				const rows = await this.prisma.$queryRaw<{ id: string; title: string | null }[]>(
					Prisma.sql`
						SELECT id, JSON_UNQUOTE(JSON_EXTRACT(data, '$.title')) AS title
						FROM MdblistCache
						WHERE id IN (${Prisma.join(chunk)})
					`
				);

				for (const row of rows) {
					// A JSON null unquotes to the literal string, not SQL NULL.
					if (typeof row.title === 'string' && row.title && row.title !== 'null') {
						titles.set(row.id, row.title);
					}
				}
			}
		} catch (error) {
			console.error('Error getting MDBList cache titles:', error);
		}

		return titles;
	}

	/**
	 * Cache movie data
	 */
	async cacheMovie(imdbId: string, data: MMovie): Promise<void> {
		await this.set(imdbId, 'movie', data);
	}

	/**
	 * Cache show data
	 */
	async cacheShow(imdbId: string, data: MShow): Promise<void> {
		await this.set(imdbId, 'show', data);
	}

	/**
	 * Cache search results
	 */
	async cacheSearch(searchKey: string, data: MSearchResponse): Promise<void> {
		await this.set(searchKey, 'search', data);
	}

	/**
	 * Cache list data
	 */
	async cacheList(listId: string, data: MList | any): Promise<void> {
		await this.set(listId, 'list', data);
	}

	/**
	 * Get cached movie data
	 */
	async getCachedMovie(imdbId: string): Promise<MMovie | null> {
		return await this.get(imdbId);
	}

	/**
	 * Get cached show data
	 */
	async getCachedShow(imdbId: string): Promise<MShow | null> {
		return await this.get(imdbId);
	}

	/**
	 * Get cached search results
	 */
	async getCachedSearch(searchKey: string): Promise<MSearchResponse | null> {
		return await this.get(searchKey);
	}

	/**
	 * Get cached list data
	 */
	async getCachedList(listId: string): Promise<any | null> {
		return await this.get(listId);
	}
}

// Create singleton instance
let mdblistCacheInstance: MdblistCacheService | null = null;

export function getMdblistCacheService(): MdblistCacheService {
	if (!mdblistCacheInstance) {
		mdblistCacheInstance = new MdblistCacheService();
	}
	return mdblistCacheInstance;
}
