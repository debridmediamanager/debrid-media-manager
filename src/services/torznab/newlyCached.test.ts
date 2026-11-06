import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// One Redis shared by every store, as the four Swarm instances share one. Down,
// it answers as ioredis 5.11.1 does with the store's options: single commands
// reject, while `pipeline().exec()` resolves with an error per command.
const redis = vi.hoisted(() => ({
	values: new Map<string, { value: string; expiresAt: number }>(),
	down: false,
	clients: 0,
	/** Every client's `error` handlers, in the order the clients were made. */
	errorHandlers: [] as Array<Array<() => void>>,
}));

vi.mock('ioredis', () => ({
	default: class {
		/** A client that has failed once stays closed, as one built not to reconnect does. */
		private closed = false;
		private handlers: Array<() => void> = [];
		constructor() {
			redis.clients++;
			redis.errorHandlers.push(this.handlers);
		}
		on(event: string, handler: () => void) {
			if (event === 'error') this.handlers.push(handler);
		}
		disconnect() {
			this.closed = true;
		}
		private check() {
			if (redis.down) this.closed = true;
			if (this.closed) throw new Error('Connection is closed.');
		}
		private read(key: string) {
			const entry = redis.values.get(key);
			return entry && entry.expiresAt > Date.now() ? entry.value : null;
		}
		async mget(keys: string[]) {
			this.check();
			return keys.map((key) => this.read(key));
		}
		async set(key: string, value: string, _ex: 'EX', seconds: number, nx?: 'NX') {
			this.check();
			if (nx && this.read(key) !== null) return null;
			redis.values.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
			return 'OK';
		}
		pipeline() {
			const queued: Array<[string, string, 'EX', number]> = [];
			const pipeline = {
				set: (...args: [string, string, 'EX', number]) => {
					queued.push(args);
					return pipeline;
				},
				exec: async () =>
					Promise.all(
						queued.map((args) =>
							this.set(...args).then(
								(result) => [null, result],
								(error) => [error, null]
							)
						)
					),
			};
			return pipeline;
		}
	},
}));

import {
	NEWLY_CACHED_BUILD_SECONDS,
	NewlyCachedStore,
	REDIS_RETRY_MS,
	RESOLVED_TTL_SECONDS,
} from './newlyCached';

const LISTS = {
	rd: [
		{
			hash: 'a'.repeat(40),
			title: 'A',
			size: 1,
			categories: [2000],
			cachedAt: 1,
			listedAt: 2,
		},
	],
	ad: [],
};
const RELEASE = { hash: 'a'.repeat(40), title: 'A', size: 1, categories: [2000] };
const LISTS_KEY = 'torznab:newly:v2:lists';
const BUILD_KEY = 'torznab:newly:v2:build';

beforeEach(() => {
	redis.values.clear();
	redis.down = false;
	redis.clients = 0;
	redis.errorHandlers = [];
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
});

afterEach(() => vi.useRealTimers());

describe('NewlyCachedStore', () => {
	it('lets one instance build per interval and every instance read what it built', async () => {
		const [one, two] = [new NewlyCachedStore('redis://x'), new NewlyCachedStore('redis://x')];

		expect(await one.claimBuild()).toBe(true);
		expect(await two.claimBuild()).toBe(false);
		await one.writeLists(LISTS);
		expect(await two.readLists()).toEqual(LISTS);

		vi.setSystemTime(Date.now() + NEWLY_CACHED_BUILD_SECONDS * 1000);
		expect(await two.claimBuild()).toBe(true);
		// The last list is still served while the next one is built.
		expect(await one.readLists()).toEqual(LISTS);
	});

	it('remembers a title, and the absence of one, for six hours', async () => {
		const store = new NewlyCachedStore('redis://x');
		const answers = new Map([
			['tt1:a', RELEASE],
			['tt1:b', null],
		]);
		await store.writeResolved(answers);

		vi.setSystemTime(Date.now() + RESOLVED_TTL_SECONDS * 1000 - 1);
		expect(await store.readResolved(['tt1:a', 'tt1:b', 'tt1:c'])).toEqual(answers);
		vi.setSystemTime(Date.now() + 1);
		expect(await store.readResolved(['tt1:a', 'tt1:b'])).toEqual(new Map());
	});

	it('keeps the list and the titles in memory when a pipelined write fails', async () => {
		const store = new NewlyCachedStore('redis://x');
		expect(await store.readLists()).toBeNull();
		redis.down = true;

		await store.writeLists(LISTS);
		await store.writeResolved(new Map([['tt1:a', RELEASE]]));

		expect(await store.readLists()).toEqual(LISTS);
		expect(await store.readResolved(['tt1:a'])).toEqual(new Map([['tt1:a', RELEASE]]));
	});

	it('goes back to Redis once it is reachable again', async () => {
		const store = new NewlyCachedStore('redis://x');
		redis.down = true;
		expect(await store.claimBuild()).toBe(true);
		redis.down = false;

		// Still on memory, whose claim holds, until the retry interval passes.
		vi.setSystemTime(Date.now() + REDIS_RETRY_MS - 1);
		expect(await store.claimBuild()).toBe(false);
		expect(redis.values.has(BUILD_KEY)).toBe(false);

		vi.setSystemTime(Date.now() + 1);
		await store.writeLists(LISTS);
		expect(redis.values.has(LISTS_KEY)).toBe(true);
		expect(redis.clients).toBe(2);
	});

	it('keeps a new client when the one it replaced reports an error late', async () => {
		const store = new NewlyCachedStore('redis://x');
		redis.down = true;
		await store.claimBuild();
		redis.down = false;
		vi.setSystemTime(Date.now() + REDIS_RETRY_MS);
		await store.writeLists(LISTS);
		expect(redis.clients).toBe(2);

		// The dropped client's socket closes now and says so.
		for (const handler of redis.errorHandlers[0]) handler();
		redis.values.clear();
		await store.writeLists(LISTS);

		expect(redis.values.has(LISTS_KEY)).toBe(true);
		expect(redis.clients).toBe(2);
	});

	it('treats a stored list of another shape as none', async () => {
		const store = new NewlyCachedStore('redis://x');
		const malformed = [
			'not json',
			'{"rd":[],"ad":"x"}',
			// The previous format, which had no `listedAt`.
			JSON.stringify({ rd: [{ ...RELEASE, cachedAt: 1 }], ad: [] }),
			JSON.stringify({ rd: [{ ...LISTS.rd[0], categories: ['2000'] }], ad: [] }),
		];
		for (const value of malformed) {
			redis.values.set(LISTS_KEY, { value, expiresAt: Date.now() + 60_000 });
			expect(await store.readLists(), value).toBeNull();
		}
	});

	it('never loses the list or the claim to the title memo filling up', async () => {
		const store = new NewlyCachedStore();
		await store.writeLists(LISTS);
		expect(await store.claimBuild()).toBe(true);

		await store.writeResolved(
			new Map(Array.from({ length: 50_001 }, (_, index) => [`tt1:${index}`, null]))
		);

		expect(await store.readLists()).toEqual(LISTS);
		expect(await store.claimBuild()).toBe(false);
	});
});
