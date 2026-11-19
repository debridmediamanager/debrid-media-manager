import { describe, expect, it, vi } from 'vitest';
import {
	cachedSubtitleLanguages,
	fetchSubtitleLanguages,
	HIT_TTL_MS,
	MAX_ENTRIES,
	MISS_TTL_MS,
	STORAGE_KEY,
} from './subtitleLanguageCache';

const memoryStorage = () => {
	const data = new Map<string, string>();
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value),
		data,
	};
};

const hash = (n: number) => n.toString(16).padStart(40, '0');

const release = (language: string) => ({
	files: {
		1: {
			path: '/a.mkv',
			bytes: 1,
			MediaInfo: { streams: [{ codec_type: 'subtitle', tags: { language } }] },
		},
	},
});

const ok = (body: unknown) =>
	({ ok: true, status: 200, headers: new Headers(), json: async () => body }) as Response;

describe('fetchSubtitleLanguages', () => {
	it('asks in batches of 100 and caches hits and misses', async () => {
		const storage = memoryStorage();
		const hashes = Array.from({ length: 150 }, (_, n) => hash(n));
		const post = vi.fn(async (_url: unknown, init?: RequestInit) => {
			const asked: string[] = JSON.parse(String(init?.body)).hashes;
			return ok({ releases: asked.includes(hash(0)) ? { [hash(0)]: release('ell') } : {} });
		});
		const onBatch = vi.fn();

		await fetchSubtitleLanguages(hashes, onBatch, { post: post as any, storage, now: () => 0 });

		expect(post).toHaveBeenCalledTimes(2);
		expect(post.mock.calls[0][0]).toBe('/api/library/mediainfo');
		expect(JSON.parse(String(post.mock.calls[0][1]?.body)).hashes).toHaveLength(100);
		expect(onBatch.mock.calls[0][0].get(hash(0))).toEqual(['gre']);
		expect(onBatch.mock.calls[0][0].get(hash(1))).toBeNull();

		const cached = cachedSubtitleLanguages([hash(0), hash(1), hash(999)], {
			storage,
			now: () => 1,
		});
		expect(cached.known.get(hash(0))).toEqual(['gre']);
		expect(cached.unknown.has(hash(1))).toBe(true);
		expect(cached.missing).toEqual([hash(999)]);
	});

	it('keeps a miss for less time than a hit', async () => {
		const storage = memoryStorage();
		const post = vi.fn(async () => ok({ releases: { [hash(0)]: release('en') } }));
		await fetchSubtitleLanguages([hash(0), hash(1)], () => {}, {
			post: post as any,
			storage,
			now: () => 0,
		});

		const after = (ms: number) =>
			cachedSubtitleLanguages([hash(0), hash(1)], { storage, now: () => ms }).missing;
		expect(after(MISS_TTL_MS - 1)).toEqual([]);
		expect(after(MISS_TTL_MS + 1)).toEqual([hash(1)]);
		expect(after(HIT_TTL_MS + 1)).toEqual([hash(0), hash(1)]);
	});

	it('waits out a 429 and asks again; leaves a failed batch uncached', async () => {
		const storage = memoryStorage();
		const wait = vi.fn(async () => {});
		const post = vi
			.fn()
			.mockResolvedValueOnce({
				ok: false,
				status: 429,
				headers: new Headers({ 'retry-after': '7' }),
			})
			.mockResolvedValueOnce(ok({ releases: {} }));
		await fetchSubtitleLanguages([hash(0)], () => {}, { post, wait, storage, now: () => 0 });
		expect(wait).toHaveBeenCalledWith(7000);
		expect(post).toHaveBeenCalledTimes(2);

		const failing = vi.fn(async () => ({ ok: false, status: 500, headers: new Headers() }));
		await fetchSubtitleLanguages([hash(5)], () => {}, {
			post: failing as any,
			wait,
			storage,
			now: () => 0,
		});
		expect(cachedSubtitleLanguages([hash(5)], { storage, now: () => 0 }).missing).toEqual([
			hash(5),
		]);
	});

	it('caps the stored entries, dropping the soonest to expire', async () => {
		const storage = memoryStorage();
		const hashes = Array.from({ length: MAX_ENTRIES + 100 }, (_, n) => hash(n));
		const post = vi.fn(async () => ok({ releases: {} }));
		await fetchSubtitleLanguages(hashes, () => {}, {
			post: post as any,
			storage,
			now: () => 0,
		});
		expect(Object.keys(JSON.parse(storage.data.get(STORAGE_KEY)!))).toHaveLength(MAX_ENTRIES);
	});
});
