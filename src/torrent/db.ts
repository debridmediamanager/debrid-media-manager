import { CachedHash, UserTorrent } from '@/torrent/userTorrent';
import { IDBPDatabase, openDB } from 'idb';

const backupToWeekNum = 2;

function currentISOWeekNumber(): number {
	const target = new Date();
	const dayNumber = (target.getUTCDay() + 6) % 7;
	target.setUTCDate(target.getUTCDate() - dayNumber + 3);
	const firstThursday = target.getTime(); // Convert to numeric value
	target.setUTCMonth(0, 1);
	if (target.getUTCDay() !== 4) {
		target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
	}
	return 1 + Math.ceil((firstThursday - target.getTime()) / (7 * 24 * 3600 * 1000)); // Use getTime for arithmetic
}

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
	for (let i = 0; i < backupToWeekNum; i++) {
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
	private torrentsTbl = `torrents-${currentISOWeekNumber() % backupToWeekNum}`;
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
		await this.insertToDB(torrent);
	}

	public async addAll(torrents: UserTorrent[]) {
		for (const torrent of torrents) {
			await this.insertToDB(torrent);
		}
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

	public async clear() {
		const db = await this.getDB();
		await db.clear(this.torrentsTbl);
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
