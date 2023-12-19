import { UserTorrent } from '@/torrent/userTorrent';
import { IDBPDatabase, openDB } from 'idb';

class UserTorrentDB {
	private db: IDBPDatabase | null = null;
	private dbName = 'DMMDB';
	private storeName = 'torrents';

	constructor() {}

	public async initializeDB() {
		const storeName = this.storeName;
		this.db = await openDB(this.dbName, 1, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(storeName)) {
					const store = db.createObjectStore(storeName, { keyPath: 'id' });
					store.createIndex('hash', 'hash', { unique: false });
				}
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
		await db.put(this.storeName, torrent);
	}

	public async all(): Promise<UserTorrent[]> {
		const db = await this.getDB();
		return db.getAll(this.storeName);
	}

	public async hashes(): Promise<Set<string>> {
		const db = await this.getDB();
		const keys = await db.getAllKeys(this.storeName);
		return new Set(keys.map((key) => key.toString()));
	}

	public async getLatestByHash(hash: string): Promise<UserTorrent | undefined> {
		const db = await this.getDB();
		const torrents = await db.getAllFromIndex(this.storeName, 'hash', hash);
		if (torrents.length === 0) return undefined;
		torrents.sort((a, b) => b.added.localeCompare(a.added));
		return torrents[0];
	}

	public async getById(id: string): Promise<UserTorrent | undefined> {
		const db = await this.getDB();
		return db.get(this.storeName, id);
	}

	public async add(torrent: UserTorrent) {
		await this.insertToDB(torrent);
	}

	public async addAll(torrents: UserTorrent[]) {
		for (const torrent of torrents) {
			await this.insertToDB(torrent);
		}
	}

	public async deleteByHash(hash: string) {
		const db = await this.getDB();
		const torrents = await db.getAllFromIndex(this.storeName, 'hash', hash);
		const deletePromises = torrents.map((torrent) => db.delete(this.storeName, torrent.id));
		await Promise.all(deletePromises);
	}

	public async deleteById(id: string) {
		const db = await this.getDB();
		await db.delete(this.storeName, id);
	}

	public async clear() {
		const db = await this.getDB();
		await db.clear(this.storeName);
	}

	public async inLibrary(hash: string): Promise<boolean> {
		const db = await this.getDB();
		const count = await db.countFromIndex(this.storeName, 'hash', hash);
		return count > 0;
	}

	public async notInLibrary(hash: string): Promise<boolean> {
		return !(await this.inLibrary(hash));
	}

	public async isDownloaded(hash: string): Promise<boolean> {
		const db = await this.getDB();
		const torrent = (await db.get(this.storeName, hash)) as UserTorrent | undefined;
		return !!torrent && torrent.progress === 100;
	}

	public async isDownloading(hash: string): Promise<boolean> {
		const db = await this.getDB();
		const torrent = (await db.get(this.storeName, hash)) as UserTorrent | undefined;
		return !!torrent && torrent.progress < 100;
	}
}

export default UserTorrentDB;
