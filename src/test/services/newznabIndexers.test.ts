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

import { _resetUpstreamIndexersForTest, getUpstreamIndexers } from '@/services/newznab/indexers';

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
