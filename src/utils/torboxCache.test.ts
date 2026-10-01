import batch from '@/test/fixtures/contentRequests/tb-checkcached-batch.json';
import uncached from '@/test/fixtures/contentRequests/tb-checkcached-uncached.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CACHE_ANSWER_TTL_MS,
	CHECKCACHED_CHUNK,
	clearTorboxCacheAnswers,
	torboxCachedHashes,
	torboxCachedHashesReusing,
} from './torboxCache';

const UNCACHED = 'abb28cb1dc25c1e2fa27aac9d1fe70d4c02be8f2';
const CACHED = '90a7b57357ed0f2ae65ca39336b3bd923684413e';

const answer = (body: unknown, status = 200) =>
	vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));

beforeEach(() => {
	vi.unstubAllGlobals();
	clearTorboxCacheAnswers();
});

describe('torboxCachedHashes', () => {
	it('reads an empty list as uncached', async () => {
		vi.stubGlobal('fetch', answer(uncached));
		expect(await torboxCachedHashes('KEY', [UNCACHED])).toEqual(new Set());
	});

	it('answers by membership, since only cached hashes come back', async () => {
		vi.stubGlobal('fetch', answer(batch));
		const result = await torboxCachedHashes('KEY', [UNCACHED, CACHED.toUpperCase()]);
		expect(result).toEqual(new Set([CACHED]));
	});

	it('sends the key as a bearer header and the hashes in the body', async () => {
		const fetchMock = answer(batch);
		vi.stubGlobal('fetch', fetchMock);
		await torboxCachedHashes('KEY', [CACHED]);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).not.toContain('KEY');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer KEY');
		expect(JSON.parse(init.body as string)).toEqual({ hashes: [CACHED] });
	});

	it('splits a long list into chunks', async () => {
		const fetchMock = answer(uncached);
		vi.stubGlobal('fetch', fetchMock);
		const hashes = Array.from({ length: CHECKCACHED_CHUNK + 1 }, (_, i) =>
			i.toString(16).padStart(40, '0')
		);
		await torboxCachedHashes('KEY', hashes);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it.each([
		['a refusal', { success: false, error: 'BAD_TOKEN' }, 403],
		['a 429', { success: false, error: 'RATE_LIMITED' }, 429],
		['a body without success', { detail: 'odd' }, 200],
	])('reports %s as unknown, never as uncached', async (_label, body, status) => {
		vi.stubGlobal('fetch', answer(body, status));
		expect(await torboxCachedHashes('KEY', [CACHED])).toBeNull();
	});

	it('reports a network failure as unknown', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('timeout');
			})
		);
		expect(await torboxCachedHashes('KEY', [CACHED])).toBeNull();
	});
});

describe('torboxCachedHashesReusing', () => {
	it('asks TorBox only for what it has not answered recently', async () => {
		const fetchMock = answer(batch);
		vi.stubGlobal('fetch', fetchMock);
		const now = 1_000_000;
		expect(await torboxCachedHashesReusing('KEY', [UNCACHED, CACHED], now)).toEqual(
			new Set([CACHED])
		);
		expect(await torboxCachedHashesReusing('OTHER', [UNCACHED, CACHED], now + 1000)).toEqual(
			new Set([CACHED])
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('asks again once an answer is stale', async () => {
		const fetchMock = answer(batch);
		vi.stubGlobal('fetch', fetchMock);
		await torboxCachedHashesReusing('KEY', [CACHED], 0);
		await torboxCachedHashesReusing('KEY', [CACHED], CACHE_ANSWER_TTL_MS);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('remembers nothing from a failed answer', async () => {
		vi.stubGlobal('fetch', answer({ success: false }, 429));
		expect(await torboxCachedHashesReusing('KEY', [CACHED], 0)).toBeNull();
		const fetchMock = answer(batch);
		vi.stubGlobal('fetch', fetchMock);
		expect(await torboxCachedHashesReusing('KEY', [CACHED], 1)).toEqual(new Set([CACHED]));
	});
});
