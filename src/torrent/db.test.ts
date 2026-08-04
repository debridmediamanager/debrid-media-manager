import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UserTorrentDB from './db';
import { UserTorrent, UserTorrentStatus } from './userTorrent';

// Reset IndexedDB before each test
beforeEach(() => {
	// @ts-ignore
	global.indexedDB = new IDBFactory();
});

// Helper to create a mock UserTorrent
function createMockTorrent(overrides: Partial<UserTorrent> = {}): UserTorrent {
	return {
		id: 'test-id-' + Math.random(),
		filename: 'test.torrent',
		title: 'Test Torrent',
		hash: 'abc123' + Math.random(),
		bytes: 1000000,
		progress: 50,
		status: UserTorrentStatus.downloading,
		serviceStatus: 'active',
		added: new Date(),
		mediaType: 'movie',
		links: [],
		selectedFiles: [],
		seeders: 10,
		speed: 1000,
		...overrides,
	};
}

describe('UserTorrentDB', () => {
	let db: UserTorrentDB;

	beforeEach(async () => {
		// Mock console.log to suppress output in tests
		vi.spyOn(console, 'log').mockImplementation(() => {});

		db = new UserTorrentDB();
		await db.initializeDB();
	});

	describe('Database Initialization', () => {
		it('should initialize database successfully', async () => {
			const newDb = new UserTorrentDB();
			await newDb.initializeDB();
			const torrents = await newDb.all();
			expect(Array.isArray(torrents)).toBe(true);
		});

		it('should initialize DB on first operation if not already initialized', async () => {
			const newDb = new UserTorrentDB();
			// Don't call initializeDB, let it auto-initialize
			const torrents = await newDb.all();
			expect(Array.isArray(torrents)).toBe(true);
		});
	});

	describe('CRUD Operations', () => {
		it('should add a torrent', async () => {
			const torrent = createMockTorrent({ id: 'add-test-1' });
			await db.add(torrent);

			const retrieved = await db.getById('add-test-1');
			expect(retrieved).toBeDefined();
			expect(retrieved?.title).toBe('Test Torrent');
		});

		it('should upsert a torrent', async () => {
			const torrent = createMockTorrent({ id: 'upsert-test-1', title: 'Original' });
			await db.upsert(torrent);

			const retrieved = await db.getById('upsert-test-1');
			expect(retrieved?.title).toBe('Original');

			// Update the torrent
			torrent.title = 'Updated';
			await db.upsert(torrent);

			const updated = await db.getById('upsert-test-1');
			expect(updated?.title).toBe('Updated');
		});

		it('should get torrent by id', async () => {
			const torrent = createMockTorrent({ id: 'get-test-1' });
			await db.add(torrent);

			const retrieved = await db.getById('get-test-1');
			expect(retrieved).toBeDefined();
			expect(retrieved?.id).toBe('get-test-1');
		});

		it('should return undefined for non-existent id', async () => {
			const retrieved = await db.getById('non-existent-id');
			expect(retrieved).toBeUndefined();
		});

		it('should delete torrent by id', async () => {
			const torrent = createMockTorrent({ id: 'delete-test-1' });
			await db.add(torrent);

			await db.deleteById('delete-test-1');

			const retrieved = await db.getById('delete-test-1');
			expect(retrieved).toBeUndefined();
		});

		it('should get all torrents', async () => {
			const torrent1 = createMockTorrent({ id: 'all-test-1' });
			const torrent2 = createMockTorrent({ id: 'all-test-2' });

			await db.add(torrent1);
			await db.add(torrent2);

			const all = await db.all();
			expect(all.length).toBeGreaterThanOrEqual(2);
			expect(all.some((t) => t.id === 'all-test-1')).toBe(true);
			expect(all.some((t) => t.id === 'all-test-2')).toBe(true);
		});
	});

	describe('Hash-based Operations', () => {
		it('should get latest torrent by hash', async () => {
			const hash = 'test-hash-123';
			const torrent1 = createMockTorrent({
				id: 'hash-test-1',
				hash,
				added: new Date('2024-01-01'),
			});
			const torrent2 = createMockTorrent({
				id: 'hash-test-2',
				hash,
				added: new Date('2024-01-02'),
			});

			await db.add(torrent1);
			await db.add(torrent2);

			const latest = await db.getLatestByHash(hash);
			expect(latest).toBeDefined();
			expect(latest?.id).toBe('hash-test-2'); // Should return the latest one
		});

		it('should return undefined for non-existent hash', async () => {
			const latest = await db.getLatestByHash('non-existent-hash');
			expect(latest).toBeUndefined();
		});

		it('should get all torrents by hash', async () => {
			const hash = 'test-hash-456';
			const torrent1 = createMockTorrent({ id: 'hash-all-1', hash });
			const torrent2 = createMockTorrent({ id: 'hash-all-2', hash });

			await db.add(torrent1);
			await db.add(torrent2);

			const torrents = await db.getAllByHash(hash);
			expect(torrents.length).toBe(2);
			expect(torrents.some((t) => t.id === 'hash-all-1')).toBe(true);
			expect(torrents.some((t) => t.id === 'hash-all-2')).toBe(true);
		});

		it('should get all unique hashes', async () => {
			const hash1 = 'unique-hash-1';
			const hash2 = 'unique-hash-2';

			await db.add(createMockTorrent({ hash: hash1 }));
			await db.add(createMockTorrent({ hash: hash2 }));
			await db.add(createMockTorrent({ hash: hash1 })); // Duplicate hash

			const hashes = await db.hashes();
			expect(hashes.size).toBeGreaterThanOrEqual(2);
			expect(hashes.has(hash1)).toBe(true);
			expect(hashes.has(hash2)).toBe(true);
		});

		it('should delete torrents by hash and service', async () => {
			const hash = 'delete-hash-123';
			await db.add(createMockTorrent({ id: 'service1:torrent1', hash }));
			await db.add(createMockTorrent({ id: 'service1:torrent2', hash }));
			await db.add(createMockTorrent({ id: 'service2:torrent3', hash }));

			await db.deleteByHash('service1', hash);

			const remaining = await db.getAllByHash(hash);
			expect(remaining.length).toBe(1);
			expect(remaining[0].id).toBe('service2:torrent3');
		});
	});

	describe('Batch Operations', () => {
		it('should add multiple torrents at once', async () => {
			const torrents = [
				createMockTorrent({ id: 'batch-add-1' }),
				createMockTorrent({ id: 'batch-add-2' }),
				createMockTorrent({ id: 'batch-add-3' }),
			];

			await db.addAll(torrents);

			const retrieved1 = await db.getById('batch-add-1');
			const retrieved2 = await db.getById('batch-add-2');
			const retrieved3 = await db.getById('batch-add-3');

			expect(retrieved1).toBeDefined();
			expect(retrieved2).toBeDefined();
			expect(retrieved3).toBeDefined();
		});

		it('should handle empty array in addAll', async () => {
			await expect(db.addAll([])).resolves.not.toThrow();
		});

		it('should replace all torrents', async () => {
			// Add initial torrents
			await db.add(createMockTorrent({ id: 'initial-1' }));
			await db.add(createMockTorrent({ id: 'initial-2' }));

			// Replace with new torrents
			const newTorrents = [
				createMockTorrent({ id: 'new-1' }),
				createMockTorrent({ id: 'new-2' }),
			];

			await db.replaceAll(newTorrents);

			const all = await db.all();
			expect(all.some((t) => t.id === 'initial-1')).toBe(false);
			expect(all.some((t) => t.id === 'initial-2')).toBe(false);
			expect(all.some((t) => t.id === 'new-1')).toBe(true);
			expect(all.some((t) => t.id === 'new-2')).toBe(true);
		});

		it('should handle large batch in replaceAll', async () => {
			// Create 1000 torrents to test chunking
			const largeBatch = Array.from({ length: 1000 }, (_, i) =>
				createMockTorrent({ id: `large-${i}` })
			);

			await db.replaceAll(largeBatch);

			const all = await db.all();
			expect(all.length).toBe(1000);
		});

		it('should replace all with empty array', async () => {
			await db.add(createMockTorrent({ id: 'to-clear' }));
			await db.replaceAll([]);

			const all = await db.all();
			expect(all.length).toBe(0);
		});

		it('should delete multiple torrents by ids', async () => {
			await db.add(createMockTorrent({ id: 'multi-delete-1' }));
			await db.add(createMockTorrent({ id: 'multi-delete-2' }));
			await db.add(createMockTorrent({ id: 'multi-delete-3' }));

			await db.deleteMany(['multi-delete-1', 'multi-delete-2']);

			const retrieved1 = await db.getById('multi-delete-1');
			const retrieved2 = await db.getById('multi-delete-2');
			const retrieved3 = await db.getById('multi-delete-3');

			expect(retrieved1).toBeUndefined();
			expect(retrieved2).toBeUndefined();
			expect(retrieved3).toBeDefined();
		});

		it('should handle empty array in deleteMany', async () => {
			await expect(db.deleteMany([])).resolves.not.toThrow();
		});
	});

	describe('Library Checks', () => {
		it('should check if hash is in library', async () => {
			const hash = 'library-hash-123';
			await db.add(createMockTorrent({ hash }));

			const inLibrary = await db.inLibrary(hash);
			expect(inLibrary).toBe(true);

			const notInLibrary = await db.notInLibrary('non-existent-hash');
			expect(notInLibrary).toBe(true);
		});

		it('should check if torrent is downloaded', async () => {
			const hash = 'downloaded-hash';
			await db.add(
				createMockTorrent({
					id: hash,
					hash,
					progress: 100,
				})
			);

			const isDownloaded = await db.isDownloaded(hash);
			expect(isDownloaded).toBe(true);
		});

		it('should check if torrent is downloading', async () => {
			const hash = 'downloading-hash';
			await db.add(
				createMockTorrent({
					id: hash,
					hash,
					progress: 50,
				})
			);

			const isDownloading = await db.isDownloading(hash);
			expect(isDownloading).toBe(true);
		});
	});

	describe('Cached Hashes', () => {
		it('should add cached hash', async () => {
			const hash = 'cached-hash-123';
			await db.addRdCachedHash(hash);

			const isCached = await db.isRdCached(hash);
			expect(isCached).toBe(true);
		});

		it('should return false for non-cached hash', async () => {
			const isCached = await db.isRdCached('non-cached-hash');
			expect(isCached).toBe(false);
		});

		it('should expire old cached hashes', async () => {
			const hash = 'expired-hash';

			// Manually add an expired hash (older than 2 days)
			const expiredDate = new Date();
			expiredDate.setDate(expiredDate.getDate() - 3);

			// Add the hash with an expired date
			await db.addRdCachedHash(hash);

			// Manually update the date in the database to be expired
			// This is a bit hacky but necessary for testing expiration logic
			const dbInstance = await (db as any).getDB();
			await dbInstance.put('cached-hashes', { hash, added: expiredDate });

			const isCached = await db.isRdCached(hash);
			expect(isCached).toBe(false);
		});
	});

	describe('Clear Operations', () => {
		it('should clear all torrents', async () => {
			await db.add(createMockTorrent());
			await db.add(createMockTorrent());

			await db.clear();

			const all = await db.all();
			expect(all.length).toBe(0);
		});

		it('clears every torrent store, not just the active one', async () => {
			await db.add(createMockTorrent());
			// simulate what the retired week-rotated store left behind
			const raw = await (db as any).getDB();
			await raw.put('torrents-1', {
				...createMockTorrent(),
				id: 'rd:leftover-from-old-rotation',
			});
			expect(await db.isEmpty()).toBe(false);

			await db.clear();

			// a logout must not leave a previous library sitting in the other store
			expect(await db.isEmpty()).toBe(true);
			expect(await db.getBackupTableData()).toEqual([]);
		});

		it('should check if database is empty', async () => {
			let empty = await db.isEmpty();
			expect(empty).toBe(true);

			await db.add(createMockTorrent());

			empty = await db.isEmpty();
			expect(empty).toBe(false);
		});

		it('should delete entire database', async () => {
			await db.add(createMockTorrent());

			await db.deleteDatabase();

			// After deletion, trying to get all should still work (will recreate DB)
			const all = await db.all();
			expect(all.length).toBe(0);
		});

		it.skip('should handle deleteDatabase when blocked', async () => {
			// Skipping this test as it's difficult to simulate the blocked state with fake-indexeddb
			// The onblocked handler is still in the code but harder to test
		});
	});

	describe('Backup Table Operations', () => {
		it('should get backup table data', async () => {
			const backupData = await db.getBackupTableData();
			expect(Array.isArray(backupData)).toBe(true);
		});

		it('should get all tables data', async () => {
			await db.add(createMockTorrent());

			const allTablesData = await db.getAllTablesData();
			expect(Array.isArray(allTablesData)).toBe(true);
			expect(allTablesData.length).toBeGreaterThan(0);

			allTablesData.forEach((tableData) => {
				expect(tableData).toHaveProperty('table');
				expect(tableData).toHaveProperty('torrents');
				expect(Array.isArray(tableData.torrents)).toBe(true);
			});
		});
	});

	describe('Error Handling', () => {
		it('should handle isEmpty error gracefully', async () => {
			// Create a fresh DB instance for this test
			const testDb = new UserTorrentDB();

			// Mock getDB to throw an error
			(testDb as any).getDB = vi.fn().mockRejectedValue(new Error('DB Error'));

			const empty = await testDb.isEmpty();
			expect(empty).toBe(true); // Should return true on error
		});
	});
});
