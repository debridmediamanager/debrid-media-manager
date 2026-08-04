import { CachedHash, UserTorrent } from '@/torrent/userTorrent';
import { IDBPDatabase, openDB } from 'idb';

// Two torrent stores exist for historical reasons: the table used to be picked
// by `isoWeek % 2`, which meant every week the app silently switched to the other
// store - one still holding the library from *two* weeks earlier - and nothing
// ever migrated or emptied it. Reads and writes now always use the first store;
// the second is still declared so existing databases keep their schema, and
// clear() empties both so a logout leaves nothing behind.
const TORRENT_STORE_COUNT = 2;
const ACTIVE_TORRENT_STORE = 'torrents-0';

type Store = {
	name: string;
	keyPath: string;
	indexes: { name: string; keyPath: string; options: { unique: boolean } }[];
};

function createObjectStores(db: IDBPDatabase, stores: Store[]) {
	for (const store of stores) {
		if (db.objectStoreNames.contains(store.name)) continue;
		const objectStore = db.createObjectStore(store.name, { keyPath: store.keyPath });
		for (const index of store.indexes) {
			objectStore.createIndex(index.name, index.keyPath, index.options);
		}
	}
}

function listTorrentObjectStores(): Store[] {
	const stores = [];
	for (let i = 0; i < TORRENT_STORE_COUNT; i++) {
		stores.push({
			name: `torrents-${i}`,
			keyPath: 'id',
			indexes: [{ name: 'hash', keyPath: 'hash', options: { unique: false } }],
		});
	}
	return stores;
}

function listMiscObjectStores(): Store[] {
	return [
		{
			name: 'cached-hashes',
			keyPath: 'hash',
			indexes: [],
		},
	];
}

class UserTorrentDB {
	private db: IDBPDatabase | null = null;
	private dbName = 'DMMDB';
	private torrentsTbl = ACTIVE_TORRENT_STORE;
	private rdHashesTbl = 'cached-hashes';

	public async initializeDB() {
		this.db = await openDB(this.dbName, 2, {
			upgrade(db) {
				createObjectStores(db, listTorrentObjectStores());
				createObjectStores(db, listMiscObjectStores());
			},
		});
	}

	private async getDB(): Promise<IDBPDatabase> {
		if (!this.db) {
			await this.initializeDB();
		}
		return this.db!;
	}

	private async insertToDB(torrent: UserTorrent) {
		const db = await this.getDB();
		await db.delete(this.torrentsTbl, torrent.id);
		await db.put(this.torrentsTbl, torrent);
	}

	public async all(): Promise<UserTorrent[]> {
		const db = await this.getDB();
		return db.getAll(this.torrentsTbl);
	}

	public async hashes(): Promise<Set<string>> {
		const db = await this.getDB();
		const torrents = await db.getAllFromIndex(this.torrentsTbl, 'hash');
		return new Set(torrents.map((t) => t.hash));
	}

	public async getLatestByHash(hash: string): Promise<UserTorrent | undefined> {
		const db = await this.getDB();
		const torrents: UserTorrent[] = await db.getAllFromIndex(this.torrentsTbl, 'hash', hash);
		if (torrents.length === 0) return undefined;
		torrents.sort((a, b) => b.added.getTime() - a.added.getTime());
		return torrents[0];
	}

	public async getAllByHash(hash: string): Promise<UserTorrent[]> {
		const db = await this.getDB();
		const torrents: UserTorrent[] = await db.getAllFromIndex(this.torrentsTbl, 'hash', hash);
		return torrents;
	}

	public async getById(id: string): Promise<UserTorrent | undefined> {
		const db = await this.getDB();
		return db.get(this.torrentsTbl, id);
	}

	public async add(torrent: UserTorrent) {
		// Use upsert for better performance
		await this.upsert(torrent);
	}

	public async upsert(torrent: UserTorrent) {
		const db = await this.getDB();
		await db.put(this.torrentsTbl, torrent);
	}

	public async addAll(torrents: UserTorrent[]) {
		if (torrents.length === 0) return;

		const db = await this.getDB();
		const tx = db.transaction(this.torrentsTbl, 'readwrite');
		const store = tx.objectStore(this.torrentsTbl);

		// Batch all operations in a single transaction
		await Promise.all(torrents.map((torrent) => store.put(torrent)));

		await tx.done;
	}

	public async replaceAll(torrents: UserTorrent[]) {
		const db = await this.getDB();
		const storeNames = Array.from(db.objectStoreNames);
		const includeHashesStore = storeNames.includes(this.rdHashesTbl);
		const transactionStores = includeHashesStore
			? [this.torrentsTbl, this.rdHashesTbl]
			: [this.torrentsTbl];

		const tx = db.transaction(transactionStores, 'readwrite');
		const torrentsStore = tx.objectStore(this.torrentsTbl);

		await torrentsStore.clear();
		if (includeHashesStore) {
			await tx.objectStore(this.rdHashesTbl).clear();
		}

		if (torrents.length > 0) {
			const chunkSize = 500;
			for (let i = 0; i < torrents.length; i += chunkSize) {
				const chunk = torrents.slice(i, i + chunkSize);
				await Promise.all(chunk.map((torrent) => torrentsStore.put(torrent)));
			}
		}

		await tx.done;
	}

	public async deleteByHash(service: string, hash: string) {
		const db = await this.getDB();
		const torrents: UserTorrent[] = await db.getAllFromIndex(this.torrentsTbl, 'hash', hash);
		const deletePromises = torrents
			.filter((t) => t.id.startsWith(service))
			.map((t) => db.delete(this.torrentsTbl, t.id));
		await Promise.all(deletePromises);
	}

	public async deleteById(id: string) {
		const db = await this.getDB();
		await db.delete(this.torrentsTbl, id);
	}

	public async deleteMany(ids: string[]) {
		if (ids.length === 0) return;

		const db = await this.getDB();
		const tx = db.transaction(this.torrentsTbl, 'readwrite');
		const store = tx.objectStore(this.torrentsTbl);

		// Batch all deletions in a single transaction
		await Promise.all(ids.map((id) => store.delete(id)));
		await tx.done;
	}

	public async clear() {
		const db = await this.getDB();
		// Every torrent store, not just the active one - the retired week-rotated
		// store would otherwise keep a copy of the library across a logout
		for (const name of Array.from(db.objectStoreNames)) {
			if (name.startsWith('torrents-')) {
				await db.clear(name);
			}
		}
		// Clear cached hashes table
		if (db.objectStoreNames.contains(this.rdHashesTbl)) {
			await db.clear(this.rdHashesTbl);
		}
	}

	public async deleteDatabase() {
		// Close the current connection if it exists
		if (this.db) {
			this.db.close();
			this.db = null;
		}
		// Delete the entire database
		await new Promise<void>((resolve, reject) => {
			const deleteReq = indexedDB.deleteDatabase(this.dbName);
			deleteReq.onsuccess = () => resolve();
			deleteReq.onerror = () => reject(deleteReq.error);
			deleteReq.onblocked = () => {
				console.warn('Database deletion blocked - other connections may be open');
				// Still resolve after a timeout to prevent hanging
				setTimeout(() => resolve(), 1000);
			};
		});
	}

	public async isEmpty(): Promise<boolean> {
		try {
			const db = await this.getDB();
			let totalCount = 0;

			// Check all torrent tables
			for (let i = 0; i < TORRENT_STORE_COUNT; i++) {
				const tableName = `torrents-${i}`;
				if (db.objectStoreNames.contains(tableName)) {
					totalCount += await db.count(tableName);
				}
			}

			// Check cached hashes table
			if (db.objectStoreNames.contains(this.rdHashesTbl)) {
				totalCount += await db.count(this.rdHashesTbl);
			}

			return totalCount === 0;
		} catch (error) {
			console.error('Error checking if database is empty:', error);
			return true; // Assume empty if error
		}
	}

	public async getBackupTableData(): Promise<UserTorrent[]> {
		const db = await this.getDB();
		const backupTorrents: UserTorrent[] = [];

		// Anything left in the stores we no longer write to - in practice whatever
		// the old week-rotated table still holds
		console.log('Active torrent store:', this.torrentsTbl);

		for (let i = 0; i < TORRENT_STORE_COUNT; i++) {
			const tableName = `torrents-${i}`;
			if (tableName !== this.torrentsTbl) {
				console.log(`Checking backup table: ${tableName}`);
				if (db.objectStoreNames.contains(tableName)) {
					const torrents = await db.getAll(tableName);
					console.log(`Found ${torrents.length} torrents in ${tableName}`);
					backupTorrents.push(...torrents);
				} else {
					console.log(`Table ${tableName} does not exist`);
				}
			}
		}

		return backupTorrents;
	}

	public async getAllTablesData(): Promise<{ table: string; torrents: UserTorrent[] }[]> {
		const db = await this.getDB();
		const allData: { table: string; torrents: UserTorrent[] }[] = [];

		// Get data from all torrent tables
		for (let i = 0; i < TORRENT_STORE_COUNT; i++) {
			const tableName = `torrents-${i}`;
			if (db.objectStoreNames.contains(tableName)) {
				const torrents = await db.getAll(tableName);
				allData.push({ table: tableName, torrents });
			}
		}

		return allData;
	}

	public async inLibrary(hash: string): Promise<boolean> {
		const db = await this.getDB();
		const count = await db.countFromIndex(this.torrentsTbl, 'hash', hash);
		return count > 0;
	}

	public async notInLibrary(hash: string): Promise<boolean> {
		return !(await this.inLibrary(hash));
	}

	public async isDownloaded(hash: string): Promise<boolean> {
		const db = await this.getDB();
		const torrent = (await db.get(this.torrentsTbl, hash)) as UserTorrent | undefined;
		return !!torrent && torrent.progress === 100;
	}

	public async isDownloading(hash: string): Promise<boolean> {
		const db = await this.getDB();
		const torrent = (await db.get(this.torrentsTbl, hash)) as UserTorrent | undefined;
		return !!torrent && torrent.progress < 100;
	}

	// Cached hashes
	public async addRdCachedHash(hash: string) {
		const db = await this.getDB();
		await db.put(this.rdHashesTbl, { hash, added: new Date() });
	}

	private async removeRdCachedHash(hash: string) {
		const db = await this.getDB();
		await db.delete(this.rdHashesTbl, hash);
	}

	public async isRdCached(hash: string): Promise<boolean> {
		const db = await this.getDB();
		const status: CachedHash = await db.get(this.rdHashesTbl, hash);
		if (!status) return false;
		const expiredDate = new Date();
		// check if expired (2 days)
		expiredDate.setDate(expiredDate.getDate() - 2);
		if (status.added < expiredDate) {
			await this.removeRdCachedHash(hash);
			return false;
		}
		return true;
	}
}

export default UserTorrentDB;
