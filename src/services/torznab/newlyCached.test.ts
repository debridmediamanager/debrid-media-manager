import { fakeRedis as redis } from '@/test/utils/fakeIoredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ioredis', async () => ({
	default: (await import('@/test/utils/fakeIoredis')).FakeIoredis,
}));

import {
	NEWLY_CACHED_BUILD_SECONDS,
	NewlyCachedStore,
	REDIS_RETRY_MS,
	RESOLVED_TTL_SECONDS,
} from './newlyCached';

const LISTS = {
	builtAt: 10,
	rd: [
		{
			hash: 'a'.repeat(40),
			title: 'A',
			size: 1,
			categories: [2000],
			cachedAt: 1,
			listedAt: 2,
			imdbId: 'tt0111161',
		},
	],
	ad: [],
};
const RELEASE = { hash: 'a'.repeat(40), title: 'A', size: 1, categories: [2000] };
const LISTS_KEY = 'torznab:newly:v3:lists';
const BUILD_KEY = 'torznab:newly:v3:build';

beforeEach(() => {
	redis.reset();
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

	it('never serves an older list than it built when Redis took a write it reported failed', async () => {
		const store = new NewlyCachedStore('redis://x');
		await store.writeLists(LISTS);
		const newer = { ...LISTS, builtAt: LISTS.builtAt + 1, ad: LISTS.rd };

		// The title memo's write lands, but the client reports it timed out and
		// is dropped, so the next list goes to memory only.
		redis.timedOut = true;
		await store.writeResolved(new Map([['tt1:a', RELEASE]]));
		redis.timedOut = false;
		expect(redis.values.has('torznab:newly:v3:title:tt1:a')).toBe(true);
		await store.writeLists(newer);
		expect(JSON.parse(redis.values.get(LISTS_KEY)!.value).builtAt).toBe(LISTS.builtAt);

		expect(await store.readLists()).toEqual(newer);
		// A fresh client reads the older shared copy; this instance's is newer.
		vi.setSystemTime(Date.now() + REDIS_RETRY_MS);
		expect(await store.readLists()).toEqual(newer);
		expect(redis.clients).toBe(2);
	});

	it('takes the shared list when another instance built it later', async () => {
		const [one, two] = [new NewlyCachedStore('redis://x'), new NewlyCachedStore('redis://x')];
		await one.writeLists(LISTS);
		const newer = { ...LISTS, builtAt: LISTS.builtAt + 1, ad: LISTS.rd };
		await two.writeLists(newer);

		expect(await one.readLists()).toEqual(newer);
	});

	it('reads a list stored before its items carried an IMDb id', async () => {
		const store = new NewlyCachedStore('redis://x');
		const { imdbId: _imdbId, ...withoutId } = LISTS.rd[0];
		const earlier = { ...LISTS, rd: [withoutId] };
		redis.values.set(LISTS_KEY, {
			value: JSON.stringify(earlier),
			expiresAt: Date.now() + 60_000,
		});

		expect(await store.readLists()).toEqual(earlier);
	});

	it('treats a stored list of another shape as none', async () => {
		const store = new NewlyCachedStore('redis://x');
		const malformed = [
			'not json',
			'{"rd":[],"ad":"x"}',
			// The previous formats, which had no `listedAt`, then no `builtAt`.
			JSON.stringify({ builtAt: 1, rd: [{ ...RELEASE, cachedAt: 1 }], ad: [] }),
			JSON.stringify({ rd: LISTS.rd, ad: [] }),
			JSON.stringify({ ...LISTS, rd: [{ ...LISTS.rd[0], imdbId: 111161 }] }),
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
