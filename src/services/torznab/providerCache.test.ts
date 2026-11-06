import { fakeRedis } from '@/test/utils/fakeIoredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const checkCachedStatus = vi.fn();
const checkPremiumizeCache = vi.fn();
const checkOffcloudCache = vi.fn();

vi.mock('@/services/torbox', () => ({
	checkCachedStatus: (...args: unknown[]) => checkCachedStatus(...args),
}));
vi.mock('@/services/premiumize', () => ({
	checkPremiumizeCache: (...args: unknown[]) => checkPremiumizeCache(...args),
}));
vi.mock('ioredis', async () => ({
	default: (await import('@/test/utils/fakeIoredis')).FakeIoredis,
}));
vi.mock('@/services/offcloud', () => ({
	checkOffcloudCache: (...args: unknown[]) => checkOffcloudCache(...args),
}));

import {
	LIVE_PROBE_LIMIT,
	probeProviderCache,
	ProviderCacheMemo,
	ProviderProbeError,
	setProviderCacheMemo,
	validateProviderKey,
} from './providerCache';
import { REDIS_RETRY_MS } from './redisWithMemory';

/** The in-memory half of the real memo, which is what runs with no REDIS_URL. */
function freshMemo() {
	const memo = new ProviderCacheMemo(undefined);
	setProviderCacheMemo(memo);
	return memo;
}

const hash = (n: number) => n.toString(16).padStart(40, '0');

beforeEach(() => {
	checkCachedStatus.mockReset();
	checkPremiumizeCache.mockReset();
	checkOffcloudCache.mockReset();
	freshMemo();
});

describe('probeProviderCache, TorBox', () => {
	it('reports the hashes TorBox names and nothing else', async () => {
		checkCachedStatus.mockResolvedValue({
			success: true,
			data: { [hash(1)]: { hash: hash(1), name: 'a', size: 1 } },
		});

		const answer = await probeProviderCache('tb', 'key', [hash(1), hash(2)]);

		expect([...answer.cached]).toEqual([hash(1)]);
		expect(answer.unresolved).toBe(0);
	});

	// TorBox joins hashes into a GET query, so a big set has to go in batches
	// rather than in one URL the server will refuse.
	it('batches a large set rather than sending one enormous query', async () => {
		checkCachedStatus.mockResolvedValue({ success: true, data: {} });
		const hashes = Array.from({ length: 250 }, (_, i) => hash(i));

		await probeProviderCache('tb', 'key', hashes);

		expect(checkCachedStatus).toHaveBeenCalledTimes(3);
		for (const [params] of checkCachedStatus.mock.calls) {
			expect((params as { hash: string[] }).hash.length).toBeLessThanOrEqual(100);
		}
	});

	// A failed probe must not read as "nothing is cached": that would silently
	// empty a cached-only feed, which an *arr reads as "no such release".
	it('raises rather than reporting an empty cache when TorBox refuses', async () => {
		checkCachedStatus.mockResolvedValue({ success: false, detail: 'Bad token' });

		await expect(probeProviderCache('tb', 'key', [hash(1)])).rejects.toBeInstanceOf(
			ProviderProbeError
		);
	});

	// A rejected key is an HTTP 403 that axios throws on, so TorBox's sentence
	// about it is in the response body. Showing "Request failed with status code
	// 403" instead would tell a sponsor nothing about what to do.
	it('surfaces TorBox own words when it refuses under an error status', async () => {
		checkCachedStatus.mockRejectedValue(
			Object.assign(new Error('Request failed with status code 403'), {
				response: { data: { detail: 'Your token is invalid or has expired.' } },
			})
		);

		await expect(probeProviderCache('tb', 'key', [hash(1)])).rejects.toMatchObject({
			message: 'Your token is invalid or has expired.',
		});
	});

	it('wraps a thrown transport error in the same typed failure', async () => {
		checkCachedStatus.mockRejectedValue(new Error('socket hang up'));

		await expect(probeProviderCache('tb', 'key', [hash(1)])).rejects.toMatchObject({
			name: 'ProviderProbeError',
			service: 'tb',
		});
	});
});

describe('probeProviderCache, Premiumize and Offcloud', () => {
	it('keeps only the Premiumize results marked cached', async () => {
		checkPremiumizeCache.mockResolvedValue([
			{ hash: hash(1), cached: true, filename: 'a', filesize: 1 },
			{ hash: hash(2), cached: false, filename: null, filesize: null },
		]);

		const answer = await probeProviderCache('pm', 'key', [hash(1), hash(2)]);

		expect([...answer.cached]).toEqual([hash(1)]);
	});

	it('keeps only the Offcloud results marked cached', async () => {
		checkOffcloudCache.mockResolvedValue([
			{ hash: hash(3), cached: true },
			{ hash: hash(4), cached: false },
		]);

		const answer = await probeProviderCache('oc', 'key', [hash(3), hash(4)]);

		expect([...answer.cached]).toEqual([hash(3)]);
	});
});

describe('probeProviderCache memoisation', () => {
	// A provider's cache is one shared pool, so the answer is the same for every
	// account. Remembering it is the only thing that makes asking affordable.
	it('asks once and reads the memo on the second search', async () => {
		checkOffcloudCache.mockResolvedValue([{ hash: hash(1), cached: true }]);

		await probeProviderCache('oc', 'key', [hash(1), hash(2)]);
		const second = await probeProviderCache('oc', 'key', [hash(1), hash(2)]);

		expect(checkOffcloudCache).toHaveBeenCalledTimes(1);
		expect([...second.cached]).toEqual([hash(1)]);
	});

	it('keeps one provider answer set out of another', async () => {
		checkOffcloudCache.mockResolvedValue([{ hash: hash(1), cached: true }]);
		checkPremiumizeCache.mockResolvedValue([
			{ hash: hash(1), cached: false, filename: null, filesize: null },
		]);

		await probeProviderCache('oc', 'key', [hash(1)]);
		const pm = await probeProviderCache('pm', 'key', [hash(1)]);

		expect(checkPremiumizeCache).toHaveBeenCalledTimes(1);
		expect(pm.cached.size).toBe(0);
	});
});

describe('probeProviderCache bounding', () => {
	// A popular title's hash list runs to thousands and a probe is a round trip
	// per batch, so one request spends a fixed budget and the rest converges
	// over the searches an *arr issues anyway.
	it('probes only up to the budget and reports the rest unresolved', async () => {
		checkOffcloudCache.mockResolvedValue([]);
		const hashes = Array.from({ length: LIVE_PROBE_LIMIT + 25 }, (_, i) => hash(i));

		const answer = await probeProviderCache('oc', 'key', hashes);

		expect(answer.unresolved).toBe(25);
		expect(checkOffcloudCache.mock.calls[0][1]).toHaveLength(LIVE_PROBE_LIMIT);
	});

	it('picks up where it left off once the memo holds the first slice', async () => {
		checkOffcloudCache.mockResolvedValue([]);
		const hashes = Array.from({ length: 12 }, (_, i) => hash(i));

		await probeProviderCache('oc', 'key', hashes, 5);
		const second = await probeProviderCache('oc', 'key', hashes, 5);

		expect(second.unresolved).toBe(2);
	});
});

describe('probeProviderCache hash spellings', () => {
	// Library pages can carry the same hash in either case. The memo and every
	// provider are case-insensitive, so the answer has to come back in the
	// caller's own spelling or it will not match a library row.
	it('answers in the spelling it was given', async () => {
		checkOffcloudCache.mockResolvedValue([{ hash: hash(1), cached: true }]);
		const upper = hash(1).toUpperCase();

		const answer = await probeProviderCache('oc', 'key', [upper]);

		expect(answer.cached.has(upper)).toBe(true);
	});

	it('asks about a repeated hash once', async () => {
		checkOffcloudCache.mockResolvedValue([]);

		await probeProviderCache('oc', 'key', [hash(1), hash(1).toUpperCase()]);

		expect(checkOffcloudCache.mock.calls[0][1]).toEqual([hash(1)]);
	});
});

describe('validateProviderKey', () => {
	it('accepts a key the provider answers for', async () => {
		checkPremiumizeCache.mockResolvedValue([]);
		await expect(validateProviderKey('pm', 'good')).resolves.toBeUndefined();
	});

	// Checked with the call the feed makes, not a cheap /user call: a key that
	// authenticates but cannot reach the cache endpoint would otherwise be
	// discovered days later as an empty feed.
	it('rejects a key the cache endpoint refuses', async () => {
		checkPremiumizeCache.mockRejectedValue(new Error('not authorized'));

		await expect(validateProviderKey('pm', 'bad')).rejects.toMatchObject({
			name: 'ProviderProbeError',
			service: 'pm',
		});
	});
});

describe('ProviderCacheMemo on Redis', () => {
	const KEY = 'torznab:pcache:tb:';
	const answers = new Map([
		[hash(1), true],
		[hash(2), false],
	]);

	beforeEach(() => {
		fakeRedis.reset();
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
	});
	afterEach(() => vi.useRealTimers());

	it('shares what one instance learned with another', async () => {
		await new ProviderCacheMemo('redis://x').write('tb', answers);
		expect(await new ProviderCacheMemo('redis://x').read('tb', [hash(1), hash(2)])).toEqual(
			answers
		);
	});

	it('keeps answers in memory when a pipelined write fails command by command', async () => {
		const memo = new ProviderCacheMemo('redis://x');
		fakeRedis.down = true;

		await memo.write('tb', answers);

		expect(await memo.read('tb', [hash(1), hash(2)])).toEqual(answers);
	});

	it('goes back to Redis once it is reachable again', async () => {
		const memo = new ProviderCacheMemo('redis://x');
		fakeRedis.down = true;
		await memo.write('tb', answers);
		fakeRedis.down = false;

		vi.setSystemTime(Date.now() + REDIS_RETRY_MS);
		await memo.write('tb', answers);

		expect(fakeRedis.values.get(`${KEY}${hash(1)}`)?.value).toBe('1');
		expect(fakeRedis.clients).toBe(2);
	});

	it('keeps a new client when the one it replaced reports an error late', async () => {
		const memo = new ProviderCacheMemo('redis://x');
		fakeRedis.down = true;
		await memo.read('tb', [hash(1)]);
		fakeRedis.down = false;
		vi.setSystemTime(Date.now() + REDIS_RETRY_MS);
		await memo.read('tb', [hash(1)]);

		for (const handler of fakeRedis.errorHandlers[0]) handler();
		await memo.write('tb', answers);

		expect(fakeRedis.values.has(`${KEY}${hash(1)}`)).toBe(true);
		expect(fakeRedis.clients).toBe(2);
	});

	it('drops its oldest answer at the memory cap, not all of them', async () => {
		const memo = new ProviderCacheMemo();
		const many = new Map(Array.from({ length: 50_001 }, (_, i) => [hash(i), true]));

		await memo.write('tb', many);

		const kept = await memo.read('tb', [hash(0), hash(1), hash(50_000)]);
		expect([...kept.keys()]).toEqual([hash(1), hash(50_000)]);
	});
});
