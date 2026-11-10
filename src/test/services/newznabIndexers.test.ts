import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// nzb2rd pulls in the Real-Debrid client; only its indexer list matters here,
// and it doubles as the fallback under test.
vi.mock('@/services/nzb2rd', () => ({
	getIndexers: vi.fn(() => [
		{
			prefix: 'ds',
			name: 'DrunkenSlug',
			url: 'https://drunkenslug.com/api',
			apiKey: 'fallback-key',
		},
	]),
}));

import { type NewznabIndexerRow, NewznabIndexerService } from '@/services/database/newznabIndexers';
import {
	_resetUpstreamIndexersForTest,
	DB_INDEXERS_TTL_MS,
	getUpstreamIndexers,
	invalidateUpstreamIndexers,
	loadUpstreamIndexers,
} from '@/services/newznab/indexers';

const originalConfig = process.env.NEWZNAB_INDEXERS;

function setConfig(value: string | undefined): void {
	if (value === undefined) {
		delete process.env.NEWZNAB_INDEXERS;
	} else {
		process.env.NEWZNAB_INDEXERS = value;
	}
	_resetUpstreamIndexersForTest();
}

beforeEach(() => {
	setConfig(undefined);
});

afterEach(() => {
	setConfig(originalConfig);
});

describe('getUpstreamIndexers', () => {
	it('parses a JSON array from NEWZNAB_INDEXERS', () => {
		setConfig(
			JSON.stringify([
				{
					prefix: 'ds',
					name: 'DrunkenSlug',
					url: 'https://drunkenslug.com/api',
					apiKey: 'k1',
				},
				{
					prefix: 'tm',
					name: 'Treasure Maps',
					url: 'https://treasure-maps.com/api',
					apiKey: 'k2',
				},
			])
		);

		expect(getUpstreamIndexers()).toEqual([
			{ prefix: 'ds', name: 'DrunkenSlug', url: 'https://drunkenslug.com/api', apiKey: 'k1' },
			{
				prefix: 'tm',
				name: 'Treasure Maps',
				url: 'https://treasure-maps.com/api',
				apiKey: 'k2',
			},
		]);
	});

	it('keeps the configured order', () => {
		setConfig(
			JSON.stringify([
				{ prefix: 'b', name: 'B', url: 'https://b/api', apiKey: 'k' },
				{ prefix: 'a', name: 'A', url: 'https://a/api', apiKey: 'k' },
			])
		);

		expect(getUpstreamIndexers().map((indexer) => indexer.prefix)).toEqual(['b', 'a']);
	});

	it('drops an entry with no API key and no keyless flag', () => {
		setConfig(
			JSON.stringify([
				{
					prefix: 'ds',
					name: 'DrunkenSlug',
					url: 'https://drunkenslug.com/api',
					apiKey: '',
				},
				{ prefix: 'tm', name: 'Treasure Maps', url: 'https://treasure-maps.com/api' },
				{ prefix: 'ng', name: 'NZBgeek', url: 'https://api.nzbgeek.info/api', apiKey: 'k' },
			])
		);

		expect(getUpstreamIndexers().map((indexer) => indexer.prefix)).toEqual(['ng']);
	});

	it('keeps a keyless entry', () => {
		setConfig(
			JSON.stringify([
				{
					prefix: 'at',
					name: 'AnimeTosho',
					url: 'https://feed.animetosho.org/api',
					apiKey: '',
					keyless: true,
				},
			])
		);

		expect(getUpstreamIndexers()).toEqual([
			{
				prefix: 'at',
				name: 'AnimeTosho',
				url: 'https://feed.animetosho.org/api',
				apiKey: '',
				keyless: true,
			},
		]);
	});

	it('drops entries missing a prefix or a url', () => {
		setConfig(
			JSON.stringify([
				{ prefix: '', name: 'No prefix', url: 'https://x/api', apiKey: 'k' },
				{ prefix: 'nu', name: 'No url', apiKey: 'k' },
				'not an object',
				{ prefix: 'ok', name: 'OK', url: 'https://ok/api', apiKey: 'k' },
			])
		);

		expect(getUpstreamIndexers().map((indexer) => indexer.prefix)).toEqual(['ok']);
	});

	it('keeps only the first entry for a duplicated prefix', () => {
		setConfig(
			JSON.stringify([
				{ prefix: 'ds', name: 'First', url: 'https://first/api', apiKey: 'k1' },
				{ prefix: 'ds', name: 'Second', url: 'https://second/api', apiKey: 'k2' },
			])
		);

		const indexers = getUpstreamIndexers();
		expect(indexers).toHaveLength(1);
		expect(indexers[0].name).toBe('First');
	});

	it('strips trailing slashes and defaults the name to the prefix', () => {
		setConfig(
			JSON.stringify([{ prefix: 'ds', url: 'https://drunkenslug.com/api//', apiKey: 'k' }])
		);

		expect(getUpstreamIndexers()).toEqual([
			{ prefix: 'ds', name: 'ds', url: 'https://drunkenslug.com/api', apiKey: 'k' },
		]);
	});

	it('carries pacing through, and ignores a malformed one', () => {
		setConfig(
			JSON.stringify([
				{
					prefix: 'tm',
					name: 'Treasure Maps',
					url: 'https://treasure-maps.com/api',
					apiKey: 'k',
					pacing: { rateLimit: 6, windowSeconds: 60 },
				},
				{
					prefix: 'ng',
					name: 'NZBgeek',
					url: 'https://api.nzbgeek.info/api',
					apiKey: 'k',
					pacing: { rateLimit: 'lots' },
				},
			])
		);

		const [treasureMaps, nzbgeek] = getUpstreamIndexers();
		expect(treasureMaps.pacing).toEqual({ rateLimit: 6, windowSeconds: 60 });
		expect(nzbgeek.pacing).toBeUndefined();
	});

	it('carries a grab limit through, and ignores a malformed one', () => {
		setConfig(
			JSON.stringify([
				{
					prefix: 'aa',
					url: 'https://a.invalid/api',
					apiKey: 'k',
					grabLimit: { rateLimit: 200, windowSeconds: 86400 },
				},
				{
					prefix: 'bb',
					url: 'https://b.invalid/api',
					apiKey: 'k',
					grabLimit: { rateLimit: 0, windowSeconds: 86400 },
				},
			])
		);

		const [first, second] = getUpstreamIndexers();
		expect(first.grabLimit).toEqual({ rateLimit: 200, windowSeconds: 86400 });
		expect(second.grabLimit).toBeUndefined();
	});

	it('falls back to the media-page indexers when the env var is unset', () => {
		expect(getUpstreamIndexers()).toEqual([
			{
				prefix: 'ds',
				name: 'DrunkenSlug',
				url: 'https://drunkenslug.com/api',
				apiKey: 'fallback-key',
			},
		]);
	});

	it('falls back when the JSON is malformed or not an array', () => {
		setConfig('{ this is not json');
		expect(getUpstreamIndexers().map((indexer) => indexer.apiKey)).toEqual(['fallback-key']);

		setConfig('{"prefix":"ds"}');
		expect(getUpstreamIndexers().map((indexer) => indexer.apiKey)).toEqual(['fallback-key']);
	});

	it('returns an empty list when every configured entry is dropped', () => {
		// Not the fallback: the operator did configure indexers, they are just all
		// unusable. Falling back here would query servers they did not ask for.
		setConfig(JSON.stringify([{ prefix: 'ds', url: 'https://drunkenslug.com/api' }]));
		expect(getUpstreamIndexers()).toEqual([]);
	});

	it('memoizes until the test reset is called', () => {
		setConfig(JSON.stringify([{ prefix: 'a', name: 'A', url: 'https://a/api', apiKey: 'k' }]));
		const first = getUpstreamIndexers();
		expect(getUpstreamIndexers()).toBe(first);

		process.env.NEWZNAB_INDEXERS = JSON.stringify([
			{ prefix: 'b', name: 'B', url: 'https://b/api', apiKey: 'k' },
		]);
		expect(getUpstreamIndexers()).toBe(first);

		_resetUpstreamIndexersForTest();
		expect(getUpstreamIndexers().map((indexer) => indexer.prefix)).toEqual(['b']);
	});
});

function row(over: Partial<NewznabIndexerRow>): NewznabIndexerRow {
	return {
		prefix: 'tm',
		name: 'Treasure Maps',
		url: 'https://treasure-maps.com/api',
		apiKey: 'db-key',
		keyless: false,
		enabled: true,
		position: 0,
		pacingRate: null,
		pacingWindow: null,
		grabRate: null,
		grabWindow: null,
		createdAt: new Date(0),
		updatedAt: new Date(0),
		...over,
	};
}

describe('loadUpstreamIndexers', () => {
	const env = [{ prefix: 'env', name: 'Env', url: 'https://env/api', apiKey: 'k' }];
	let list: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		setConfig(JSON.stringify(env));
		list = vi.spyOn(NewznabIndexerService.prototype, 'listIndexers');
	});

	afterEach(() => {
		list.mockRestore();
		vi.useRealTimers();
	});

	it('reads the enabled rows in table order, with their limits', async () => {
		list.mockResolvedValue([
			row({ prefix: 'tm', grabRate: 200, grabWindow: 86400 }),
			row({ prefix: 'off', enabled: false }),
			row({ prefix: 'at', name: 'NZBAtlas', pacingRate: 200, pacingWindow: 3600 }),
		]);
		expect(await loadUpstreamIndexers()).toEqual([
			{
				prefix: 'tm',
				name: 'Treasure Maps',
				url: 'https://treasure-maps.com/api',
				apiKey: 'db-key',
				grabLimit: { rateLimit: 200, windowSeconds: 86400 },
			},
			{
				prefix: 'at',
				name: 'NZBAtlas',
				url: 'https://treasure-maps.com/api',
				apiKey: 'db-key',
				pacing: { rateLimit: 200, windowSeconds: 3600 },
			},
		]);
	});

	it('uses the env list while the table is empty', async () => {
		list.mockResolvedValue([]);
		expect((await loadUpstreamIndexers()).map((i) => i.prefix)).toEqual(['env']);
	});

	it('searches nothing, not the env list, when every row is disabled', async () => {
		list.mockResolvedValue([row({ enabled: false })]);
		expect(await loadUpstreamIndexers()).toEqual([]);
	});

	it('drops a row with no key unless it is keyless', async () => {
		list.mockResolvedValue([
			row({ prefix: 'nokey', apiKey: '' }),
			row({ prefix: 'free', apiKey: '', keyless: true }),
		]);
		expect((await loadUpstreamIndexers()).map((i) => i.prefix)).toEqual(['free']);
	});

	it('reads the table once per TTL, and again after an invalidation', async () => {
		vi.useFakeTimers();
		list.mockResolvedValue([row({ prefix: 'a' })]);
		await Promise.all([loadUpstreamIndexers(), loadUpstreamIndexers()]);
		await loadUpstreamIndexers();
		expect(list).toHaveBeenCalledTimes(1);

		list.mockResolvedValue([row({ prefix: 'b' })]);
		vi.advanceTimersByTime(DB_INDEXERS_TTL_MS + 1);
		expect((await loadUpstreamIndexers()).map((i) => i.prefix)).toEqual(['b']);
		expect(list).toHaveBeenCalledTimes(2);

		list.mockResolvedValue([row({ prefix: 'c' })]);
		invalidateUpstreamIndexers();
		expect((await loadUpstreamIndexers()).map((i) => i.prefix)).toEqual(['c']);
	});

	it('keeps the last list read when the database fails, and the env list before any', async () => {
		vi.useFakeTimers();
		list.mockRejectedValue(new Error("Can't reach database server"));
		expect((await loadUpstreamIndexers()).map((i) => i.prefix)).toEqual(['env']);

		list.mockResolvedValue([row({ prefix: 'a' })]);
		vi.advanceTimersByTime(DB_INDEXERS_TTL_MS + 1);
		expect((await loadUpstreamIndexers()).map((i) => i.prefix)).toEqual(['a']);

		list.mockRejectedValue(new Error("Can't reach database server"));
		vi.advanceTimersByTime(DB_INDEXERS_TTL_MS + 1);
		expect((await loadUpstreamIndexers()).map((i) => i.prefix)).toEqual(['a']);
	});
});
