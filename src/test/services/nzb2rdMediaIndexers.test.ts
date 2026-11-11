import { type NewznabIndexerRow, NewznabIndexerService } from '@/services/database/newznabIndexers';
import { _resetIndexerTableForTest, invalidateIndexerTable } from '@/services/newznab/indexerTable';
import { fetchNzb, getIndexers, loadIndexers, parseReleaseId } from '@/services/nzb2rd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The title page's Usenet search reads its indexers from the NewznabIndexer table
// (`mediaPage`), and keeps the environment's DrunkenSlug + altHUB while the table is empty.

const row = (over: Partial<NewznabIndexerRow>): NewznabIndexerRow => ({
	prefix: 'ds',
	name: 'DrunkenSlug',
	url: 'https://drunkenslug.com/api',
	apiKey: 'ds-key',
	keyless: false,
	enabled: true,
	mediaPage: false,
	position: 0,
	pacingRate: null,
	pacingWindow: null,
	grabRate: null,
	grabWindow: null,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	...over,
});

const env = { ...process.env };
let list: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	process.env.NEWZNAB_URL = 'https://drunkenslug.com/api';
	process.env.NEWZNAB_API_KEY = 'env-ds-key';
	process.env.ALTHUB_API_KEY = 'env-ah-key';
	_resetIndexerTableForTest();
	list = vi.spyOn(NewznabIndexerService.prototype, 'listIndexers');
});

afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	process.env = { ...env };
	_resetIndexerTableForTest();
	list.mockResolvedValue([]);
});

describe('title-page Usenet indexers', () => {
	it('keep the environment pair while the table is empty', async () => {
		list.mockResolvedValue([]);
		expect((await loadIndexers()).map((i) => [i.prefix, i.apiKey])).toEqual([
			['ds', 'env-ds-key'],
			['ah', 'env-ah-key'],
		]);
	});

	it('come from the table rows ticked for the title page, in table order', async () => {
		list.mockResolvedValue([
			row({ prefix: 'ds', mediaPage: true }),
			row({ prefix: 'ah', name: 'altHUB', mediaPage: false }),
			row({
				prefix: 'ng',
				name: 'NZBgeek',
				url: 'https://ng/api',
				apiKey: 'ng-key',
				mediaPage: true,
				enabled: false,
			}),
			row({ prefix: 'nk', name: 'No key', apiKey: '', keyless: true, mediaPage: true }),
		]);
		expect((await loadIndexers()).map((i) => i.prefix)).toEqual(['ds', 'ng']);
		// what the synchronous readers see after the refresh
		expect(getIndexers().map((i) => i.prefix)).toEqual(['ds', 'ng']);
		expect(parseReleaseId('ah:123')).toBeNull();
		expect(parseReleaseId('ng:5')?.indexer.url).toBe('https://ng/api');
		expect(parseReleaseId('abc')?.indexer.prefix).toBe('ds');
	});

	it('are refreshed by an NZB fetch before its id is routed', async () => {
		list.mockResolvedValue([row({ prefix: 'ds', mediaPage: true })]);
		await loadIndexers();
		list.mockResolvedValue([
			row({ prefix: 'ds', mediaPage: true }),
			row({
				prefix: 'ng',
				name: 'NZBgeek',
				url: 'https://ng/api',
				apiKey: 'ng-key',
				mediaPage: true,
			}),
		]);
		invalidateIndexerTable();
		const fetchMock = vi.fn(async () => new Response('<nzb></nzb>'));
		vi.stubGlobal('fetch', fetchMock);
		await fetchNzb('ng:42');
		expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(
			/^https:\/\/ng\/api\?t=get&id=42&apikey=ng-key/
		);
	});
});
