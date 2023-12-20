import { UserTorrent } from '@/torrent/userTorrent';
import { IDBPDatabase, openDB } from 'idb';

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

function createObjectStore(db: IDBPDatabase, storeName: string) {
	const store = db.createObjectStore(storeName, { keyPath: 'id' });
	store.createIndex('hash', 'hash', { unique: false });
}

const storeBase = 'torrents';
const backupToWeek = 2;

class UserTorrentDB {
	private db: IDBPDatabase | null = null;
	private dbName = 'DMMDB';
	private storeName = `${storeBase}-${currentISOWeekNumber() % backupToWeek}`;

	public async initializeDB() {
		const storeName = this.storeName;
		this.db = await openDB(this.dbName, 1, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(storeName)) {
					for (let i = 0; i < backupToWeek; i++) {
						createObjectStore(db, `${storeBase}-${i}`);
					}
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
		const torrents = await db.getAllFromIndex(this.storeName, 'hash');
		return new Set(torrents.map((t) => t.hash));
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

export const DeleteUserTorrentDB = async () => {
	window.indexedDB.deleteDatabase('DMMDB');
	// await deleteDB('DMMDB', {
	// 	blocked: () => alert('database is still open, refresh the page first to delete cache'),
	// });
};

export default UserTorrentDB;
