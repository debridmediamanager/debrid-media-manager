/**
 * Multi-level cache manager inspired by Zurg's caching strategy
 * Implements memory cache, IndexedDB persistence, and service worker integration
 */

interface CacheEntry<T> {
	data: T;
	timestamp: number;
	etag?: string;
	expiresAt?: number;
}

interface CacheConfig {
	memoryTTL: number; // Memory cache TTL in ms
	persistTTL: number; // IndexedDB TTL in ms
	maxMemoryItems: number;
	namespace: string;
}

export class CacheManager {
	private memoryCache: Map<string, CacheEntry<any>> = new Map();
	private dbName: string;
	private config: CacheConfig;
	private db: IDBDatabase | null = null;
	private initPromise: Promise<void> | null = null;
	private lastCleanup: number = 0;
	private cleanupInterval: number = 60000; // 1 minute

	constructor(config: Partial<CacheConfig> = {}) {
		this.config = {
			memoryTTL: 5 * 60 * 1000, // 5 minutes default
			persistTTL: 24 * 60 * 60 * 1000, // 24 hours default
			maxMemoryItems: 1000,
			namespace: 'dmm_cache',
			...config,
		};
		this.dbName = `${this.config.namespace}_db`;
		this.initPromise = this.initDB();
	}

	private async initDB(): Promise<void> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, 2);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				this.db = request.result;
				resolve();
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;

				// Create stores if they don't exist
				if (!db.objectStoreNames.contains('cache')) {
					const store = db.createObjectStore('cache', { keyPath: 'key' });
					store.createIndex('timestamp', 'timestamp', { unique: false });
					store.createIndex('expiresAt', 'expiresAt', { unique: false });
				}
			};
		});
	}

	private async ensureDB(): Promise<void> {
		if (this.initPromise) {
			await this.initPromise;
			this.initPromise = null;
		}
		if (!this.db) {
			throw new Error('Database not initialized');
		}
	}

	/**
	 * Get data from cache with multi-level fallback
	 * Memory -> IndexedDB -> Fetch function
	 */
	async get<T>(
		key: string,
		fetchFn?: () => Promise<T>,
		options: {
			forceRefresh?: boolean;
			ttl?: number;
			etag?: string;
		} = {}
	): Promise<T | null> {
		console.log(`[Cache] Getting key: ${key}, forceRefresh: ${options.forceRefresh}`);

		// Cleanup old entries periodically
		if (Date.now() - this.lastCleanup > this.cleanupInterval) {
			this.cleanupMemory();
			this.lastCleanup = Date.now();
		}

		// Check memory cache first (unless force refresh)
		if (!options.forceRefresh) {
			const memEntry = this.memoryCache.get(key);
			if (memEntry) {
				const isExpired = Date.now() >= (memEntry.expiresAt || Infinity);
				console.log(`[Cache] Memory cache hit for ${key}, expired: ${isExpired}`);

				if (!isExpired) {
					// Check etag for validation
					if (!options.etag || options.etag === memEntry.etag) {
						return memEntry.data as T;
					}
				} else {
					console.log(`[Cache] Memory cache entry for ${key} is expired`);
				}
			} else {
				console.log(`[Cache] Memory cache miss for ${key}`);
			}
		} else {
			console.log(`[Cache] Skipping memory cache due to forceRefresh for ${key}`);
		}

		// Check IndexedDB (unless force refresh)
		if (!options.forceRefresh && this.db) {
			try {
				console.log(`[Cache] Checking IndexedDB for ${key}...`);
				await this.ensureDB();
				const dbEntry = await this.getFromDB(key);
				if (dbEntry) {
					const isExpired = Date.now() >= (dbEntry.expiresAt || Infinity);
					console.log(
						`[Cache] IndexedDB hit for ${key}, expired: ${isExpired}, expires: ${new Date(dbEntry.expiresAt || 0).toISOString()}`
					);

					if (!isExpired) {
						// Promote to memory cache
						console.log(`[Cache] Promoting IndexedDB entry to memory cache for ${key}`);
						this.setMemory(key, dbEntry.data, dbEntry.etag, options.ttl);
						return dbEntry.data as T;
					} else {
						console.log(`[Cache] IndexedDB entry for ${key} is expired`);
					}
				} else {
					console.log(`[Cache] IndexedDB miss for ${key}`);
				}
			} catch (error) {
				console.warn(`[Cache] IndexedDB read error for ${key}:`, error);
			}
		} else if (!this.db) {
			console.log(`[Cache] IndexedDB not available for ${key}`);
		} else {
			console.log(`[Cache] Skipping IndexedDB due to forceRefresh for ${key}`);
		}

		// Fetch fresh data if provided
		if (fetchFn) {
			console.log(`[Cache] No cache hit for ${key}, calling fetchFn`);
			try {
				const data = await fetchFn();
				console.log(`[Cache] FetchFn returned data for ${key}`);
				await this.set(key, data, options.etag, options.ttl);
				return data;
			} catch (error) {
				// On fetch error, return stale data if available
				const staleEntry = this.memoryCache.get(key);
				if (staleEntry) {
					console.warn(`[Cache] Returning stale data due to fetch error for ${key}`);
					return staleEntry.data as T;
				}
				console.error(`[Cache] FetchFn failed for ${key}:`, error);
				throw error;
			}
		}

		console.log(`[Cache] No data available for ${key} (no fetchFn provided)`);
		return null;
	}

	/**
	 * Set data in both memory and persistent cache
	 */
	async set<T>(key: string, data: T, etag?: string, ttl?: number): Promise<void> {
		const memoryTTL = ttl || this.config.memoryTTL;
		const persistTTL = ttl || this.config.persistTTL;

		// Set in memory
		this.setMemory(key, data, etag, memoryTTL);

		// Set in IndexedDB
		if (this.db) {
			try {
				await this.ensureDB();
				await this.setInDB(key, data, etag, persistTTL);
			} catch (error) {
				console.warn('IndexedDB write error:', error);
			}
		}
	}

	private setMemory<T>(key: string, data: T, etag?: string, ttl?: number): void {
		// Enforce memory limit
		if (this.memoryCache.size >= this.config.maxMemoryItems) {
			// Remove oldest entry
			const firstKey = this.memoryCache.keys().next().value;
			if (firstKey) {
				this.memoryCache.delete(firstKey);
			}
		}

		this.memoryCache.set(key, {
			data,
			timestamp: Date.now(),
			etag,
			expiresAt: ttl ? Date.now() + ttl : undefined,
		});
	}

	private async getFromDB(key: string): Promise<CacheEntry<any> | null> {
		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error('Database not initialized'));
				return;
			}

			const transaction = this.db.transaction(['cache'], 'readonly');
			const store = transaction.objectStore('cache');
			const request = store.get(key);

			request.onsuccess = () => {
				const result = request.result;
				resolve(result ? result.entry : null);
			};
			request.onerror = () => reject(request.error);
		});
	}

	private async setInDB<T>(key: string, data: T, etag?: string, ttl?: number): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error('Database not initialized'));
				return;
			}

			const transaction = this.db.transaction(['cache'], 'readwrite');
			const store = transaction.objectStore('cache');
			const entry: CacheEntry<T> = {
				data,
				timestamp: Date.now(),
				etag,
				expiresAt: ttl ? Date.now() + ttl : undefined,
			};

			const request = store.put({
				key,
				entry,
				timestamp: entry.timestamp,
				expiresAt: entry.expiresAt,
			});

			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	/**
	 * Batch get operation for efficient parallel fetching
	 */
	async getBatch<T>(
		keys: string[],
		fetchFn?: (keys: string[]) => Promise<Map<string, T>>,
		options: { forceRefresh?: boolean; ttl?: number } = {}
	): Promise<Map<string, T>> {
		const results = new Map<string, T>();
		const missingKeys: string[] = [];

		// Check cache for each key
		for (const key of keys) {
			const cached = await this.get<T>(key, undefined, options);
			if (cached !== null) {
				results.set(key, cached);
			} else {
				missingKeys.push(key);
			}
		}

		// Fetch missing keys in batch
		if (missingKeys.length > 0 && fetchFn) {
			try {
				const fetched = await fetchFn(missingKeys);
				for (const [key, value] of fetched) {
					await this.set(key, value, undefined, options.ttl);
					results.set(key, value);
				}
			} catch (error) {
				console.error('Batch fetch error:', error);
			}
		}

		return results;
	}

	/**
	 * Clear specific keys or entire cache
	 */
	async clear(keys?: string[]): Promise<void> {
		if (keys) {
			// Clear specific keys
			for (const key of keys) {
				this.memoryCache.delete(key);
				if (this.db) {
					try {
						await this.ensureDB();
						await this.deleteFromDB(key);
					} catch (error) {
						console.warn('Failed to delete from DB:', error);
					}
				}
			}
		} else {
			// Clear all
			this.memoryCache.clear();
			if (this.db) {
				try {
					await this.ensureDB();
					await this.clearDB();
				} catch (error) {
					console.warn('Failed to clear DB:', error);
				}
			}
		}
	}

	private async deleteFromDB(key: string): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error('Database not initialized'));
				return;
			}

			const transaction = this.db.transaction(['cache'], 'readwrite');
			const store = transaction.objectStore('cache');
			const request = store.delete(key);

			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	private async clearDB(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error('Database not initialized'));
				return;
			}

			const transaction = this.db.transaction(['cache'], 'readwrite');
			const store = transaction.objectStore('cache');
			const request = store.clear();

			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	/**
	 * Clean up expired entries from memory cache
	 */
	private cleanupMemory(): void {
		const now = Date.now();
		const keysToDelete: string[] = [];

		for (const [key, entry] of this.memoryCache) {
			if (entry.expiresAt && now >= entry.expiresAt) {
				keysToDelete.push(key);
			}
		}

		for (const key of keysToDelete) {
			this.memoryCache.delete(key);
		}
	}

	/**
	 * Get cache statistics
	 */
	getStats(): {
		memorySize: number;
		memoryKeys: string[];
		oldestEntry: number | null;
		newestEntry: number | null;
	} {
		let oldest: number | null = null;
		let newest: number | null = null;

		for (const entry of this.memoryCache.values()) {
			if (oldest === null || entry.timestamp < oldest) {
				oldest = entry.timestamp;
			}
			if (newest === null || entry.timestamp > newest) {
				newest = entry.timestamp;
			}
		}

		return {
			memorySize: this.memoryCache.size,
			memoryKeys: Array.from(this.memoryCache.keys()),
			oldestEntry: oldest,
			newestEntry: newest,
		};
	}

	/**
	 * Close database connection
	 */
	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
		this.memoryCache.clear();
	}
}

// Singleton instance for global cache
let globalCache: CacheManager | null = null;

export function getGlobalCache(): CacheManager {
	if (!globalCache) {
		globalCache = new CacheManager({
			namespace: 'dmm_global',
			memoryTTL: 5 * 60 * 1000, // 5 minutes
			persistTTL: 24 * 60 * 60 * 1000, // 24 hours
			maxMemoryItems: 2000,
		});
	}
	return globalCache;
}
