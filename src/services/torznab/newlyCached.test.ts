import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// One Redis shared by every store, as the four Swarm instances share one.
const redis = vi.hoisted(() => ({
	values: new Map<string, { value: string; expiresAt: number }>(),
	down: false,
}));

vi.mock('ioredis', () => ({
	default: class {
		on() {}
		private read(key: string) {
			const entry = redis.values.get(key);
			return entry && entry.expiresAt > Date.now() ? entry.value : null;
		}
		async mget(keys: string[]) {
			if (redis.down) throw new Error('connection refused');
			return keys.map((key) => this.read(key));
		}
		async set(key: string, value: string, _ex: 'EX', seconds: number, nx?: 'NX') {
			if (redis.down) throw new Error('connection refused');
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
				exec: async () => {
					for (const args of queued) await this.set(...args);
					return [];
				},
			};
			return pipeline;
		}
	},
}));

import {
	NEWLY_CACHED_BUILD_SECONDS,
	NewlyCachedStore,
	RESOLVED_TTL_SECONDS,
	UNRESOLVED_TTL_SECONDS,
} from './newlyCached';

const LISTS = {
	rd: [{ hash: 'a'.repeat(40), title: 'A', size: 1, categories: [2000], cachedAt: 1 }],
	ad: [],
};
const RELEASE = { hash: 'a'.repeat(40), title: 'A', size: 1, categories: [2000] };

beforeEach(() => {
	redis.values.clear();
	redis.down = false;
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

	it('remembers a title for hours and a miss for half an hour', async () => {
		const store = new NewlyCachedStore('redis://x');
		await store.writeResolved(
			new Map([
				['tt1:a', RELEASE],
				['tt1:b', null],
			])
		);

		expect(await store.readResolved(['tt1:a', 'tt1:b', 'tt1:c'])).toEqual(
			new Map([
				['tt1:a', RELEASE],
				['tt1:b', null],
			])
		);
		vi.setSystemTime(Date.now() + UNRESOLVED_TTL_SECONDS * 1000);
		expect(await store.readResolved(['tt1:a', 'tt1:b'])).toEqual(new Map([['tt1:a', RELEASE]]));
		vi.setSystemTime(Date.now() + RESOLVED_TTL_SECONDS * 1000);
		expect(await store.readResolved(['tt1:a'])).toEqual(new Map());
	});

	it('keeps working in memory when Redis is down', async () => {
		redis.down = true;
		const store = new NewlyCachedStore('redis://x');

		expect(await store.readLists()).toBeNull();
		expect(await store.claimBuild()).toBe(true);
		expect(await store.claimBuild()).toBe(false);
		await store.writeLists(LISTS);
		expect(await store.readLists()).toEqual(LISTS);
	});
});
