import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UserTorrentDB from './db';
import { UserTorrent, UserTorrentStatus } from './userTorrent';

beforeEach(() => {
	// @ts-ignore
	global.indexedDB = new IDBFactory();
});

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

describe('UserTorrentDB comprehensive', () => {
	let db: UserTorrentDB;

	beforeEach(async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		db = new UserTorrentDB();
		await db.initializeDB();
	});

	describe('multiple initializeDB calls', () => {
		it('handles being initialized twice without error', async () => {
			await db.initializeDB();
			const torrents = await db.all();
			expect(Array.isArray(torrents)).toBe(true);
		});
	});

	describe('upsert idempotency', () => {
		it('updates all fields on upsert', async () => {
			const torrent = createMockTorrent({
				id: 'upsert-full',
				title: 'Original',
				progress: 10,
				bytes: 500,
			});
			await db.upsert(torrent);

			const updated = {
				...torrent,
				title: 'Updated',
				progress: 100,
				bytes: 1000,
				speed: 5000,
			};
			await db.upsert(updated);

			const result = await db.getById('upsert-full');
			expect(result?.title).toBe('Updated');
			expect(result?.progress).toBe(100);
			expect(result?.bytes).toBe(1000);
			expect(result?.speed).toBe(5000);
		});
	});

	describe('getLatestByHash ordering', () => {
		it('returns the torrent with the most recent added date', async () => {
			const hash = 'ordering-hash';
			await db.add(createMockTorrent({ id: 'oldest', hash, added: new Date('2020-01-01') }));
			await db.add(createMockTorrent({ id: 'newest', hash, added: new Date('2024-06-15') }));
			await db.add(createMockTorrent({ id: 'middle', hash, added: new Date('2022-06-15') }));

			const latest = await db.getLatestByHash(hash);
			expect(latest?.id).toBe('newest');
		});
	});

	describe('deleteByHash with no matching service', () => {
		it('does not delete torrents from other services', async () => {
			const hash = 'cross-service-hash';
			await db.add(createMockTorrent({ id: 'rd:torrent1', hash }));
			await db.add(createMockTorrent({ id: 'ad:torrent2', hash }));

			await db.deleteByHash('tb', hash);

			const remaining = await db.getAllByHash(hash);
			expect(remaining.length).toBe(2);
		});
	});

	describe('deleteMany with non-existent ids', () => {
		it('does not throw when deleting non-existent ids', async () => {
			await db.add(createMockTorrent({ id: 'exists' }));
			await expect(
				db.deleteMany(['exists', 'does-not-exist-1', 'does-not-exist-2'])
			).resolves.not.toThrow();

			const result = await db.getById('exists');
			expect(result).toBeUndefined();
		});
	});

	describe('isDownloaded and isDownloading edge cases', () => {
		it('returns false for isDownloaded when progress is less than 100', async () => {
			const hash = 'partial-dl';
			await db.add(createMockTorrent({ id: hash, hash, progress: 99 }));
			expect(await db.isDownloaded(hash)).toBe(false);
		});

		it('returns false for isDownloading when progress is 100', async () => {
			const hash = 'complete-dl';
			await db.add(createMockTorrent({ id: hash, hash, progress: 100 }));
			expect(await db.isDownloading(hash)).toBe(false);
		});

		it('returns false for isDownloaded when torrent does not exist', async () => {
			expect(await db.isDownloaded('nonexistent')).toBe(false);
		});

		it('returns false for isDownloading when torrent does not exist', async () => {
			expect(await db.isDownloading('nonexistent')).toBe(false);
		});

		it('returns true for isDownloading when progress is 0', async () => {
			const hash = 'zero-progress';
			await db.add(createMockTorrent({ id: hash, hash, progress: 0 }));
			expect(await db.isDownloading(hash)).toBe(true);
		});
	});

	describe('replaceAll clears cached hashes', () => {
		it('removes cached hashes when replacing all torrents', async () => {
			await db.addRdCachedHash('cached-1');
			await db.addRdCachedHash('cached-2');
			expect(await db.isRdCached('cached-1')).toBe(true);

			await db.replaceAll([createMockTorrent({ id: 'fresh' })]);

			expect(await db.isRdCached('cached-1')).toBe(false);
			expect(await db.isRdCached('cached-2')).toBe(false);
		});
	});

	describe('clear also clears cached hashes', () => {
		it('removes all data including cached hashes', async () => {
			await db.add(createMockTorrent({ id: 'to-clear' }));
			await db.addRdCachedHash('hash-to-clear');

			await db.clear();

			const all = await db.all();
			expect(all.length).toBe(0);
			expect(await db.isRdCached('hash-to-clear')).toBe(false);
		});
	});

	describe('isEmpty checks all tables', () => {
		it('returns false when only cached hashes exist', async () => {
			await db.addRdCachedHash('only-cached');
			const empty = await db.isEmpty();
			expect(empty).toBe(false);
		});
	});

	describe('hashes returns deduplicated set', () => {
		it('returns unique hashes even with many duplicates', async () => {
			const sharedHash = 'shared-hash-val';
			for (let i = 0; i < 5; i++) {
				await db.add(createMockTorrent({ id: `dup-${i}`, hash: sharedHash }));
			}
			await db.add(createMockTorrent({ id: 'unique-1', hash: 'unique-hash-val' }));

			const hashes = await db.hashes();
			expect(hashes.has(sharedHash)).toBe(true);
			expect(hashes.has('unique-hash-val')).toBe(true);
			expect(hashes.size).toBe(2);
		});
	});

	describe('addAll transaction atomicity', () => {
		it('adds all torrents in a single transaction', async () => {
			const torrents = Array.from({ length: 50 }, (_, i) =>
				createMockTorrent({ id: `atomic-${i}`, hash: `hash-${i}` })
			);

			await db.addAll(torrents);

			const all = await db.all();
			expect(all.length).toBe(50);
		});
	});

	describe('deleteDatabase and reinitialize', () => {
		it('can reinitialize and use database after deletion', async () => {
			await db.add(createMockTorrent({ id: 'before-delete' }));
			await db.deleteDatabase();

			await db.initializeDB();
			await db.add(createMockTorrent({ id: 'after-delete' }));

			const result = await db.getById('after-delete');
			expect(result).toBeDefined();
			expect(await db.getById('before-delete')).toBeUndefined();
		});
	});

	describe('isRdCached expiry boundary', () => {
		it('keeps hash that is exactly at the 2-day boundary', async () => {
			const hash = 'boundary-hash';
			await db.addRdCachedHash(hash);

			const dbInstance = await (db as any).getDB();
			const almostExpired = new Date();
			almostExpired.setDate(almostExpired.getDate() - 1);
			almostExpired.setHours(almostExpired.getHours() - 23);
			await dbInstance.put('cached-hashes', { hash, added: almostExpired });

			expect(await db.isRdCached(hash)).toBe(true);
		});
	});
});
