import { Firestore, Settings } from '@google-cloud/firestore';

const firebaseSettings: Settings = {
	projectId: process.env.FIREBASE_PROJECT_ID,
	credentials: {
		client_email: process.env.FIREBASE_CLIENT_EMAIL,
		private_key: process.env.FIREBASE_PRIVATE_KEY,
	},
	ssl: true,
	maxIdleChannels: 2,
	ignoreUndefinedProperties: true,
	preferRest: false,
};

export class FirestoreCache {
	private db: Firestore;

	constructor() {
		this.db = new Firestore(firebaseSettings);
	}

	public async cacheJsonValue<T>(key: string[], value: T) {
		const sortedKey = key.sort();
		const firestoreKey = sortedKey.join(':');

		await this.db.runTransaction(async (t) => {
			const counterDoc = this.db.doc('counters/cache');
			const counterSnap = await t.get(counterDoc);
			const newCount = (counterSnap.data()?.count || 0) + 1;

			t.set(this.db.collection('cache').doc(firestoreKey), { value });
			t.set(counterDoc, { count: newCount });
		});
	}

	public async getCachedJsonValue<T>(key: string[]): Promise<T | undefined> {
		const sortedKey = key.sort();
		const firestoreKey = sortedKey.join(':');
		const doc = await this.db.collection('cache').doc(firestoreKey).get();
		if (!doc.exists) {
			return undefined;
		} else {
			return doc.data()?.value as T;
		}
	}

	public async deleteCachedJsonValue(key: string[]): Promise<void> {
		const sortedKey = key.sort();
		const firestoreKey = sortedKey.join(':');

		await this.db.runTransaction(async (t) => {
			const counterDoc = this.db.doc('counters/cache');
			const counterSnap = await t.get(counterDoc);
			const newCount = (counterSnap.data()?.count || 0) - 1;

			t.delete(this.db.collection('cache').doc(firestoreKey));
			t.set(counterDoc, { count: newCount });
		});
	}

	public async getDbSize(): Promise<number> {
		const counterDoc = await this.db.doc('counters/cache').get();
		return counterDoc.data()?.count || 0;
	}
}
