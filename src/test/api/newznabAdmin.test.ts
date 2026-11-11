import adminHandler from '@/pages/api/newznab/admin';
import { type NewznabIndexerRow, NewznabIndexerService } from '@/services/database/newznabIndexers';
import * as indexers from '@/services/newznab/indexers';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>();
	return { ...actual, withIpRateLimit: (wrapped: unknown) => wrapped };
});

const TOKEN = 'test-newznab-admin-token';
const KEY = 'secret-api-key-0123456789e08';

const call = async (
	init: Parameters<typeof createMockRequest>[0],
	token: string | null = TOKEN
) => {
	const req = createMockRequest({
		...init,
		headers: token ? { authorization: `Bearer ${token}` } : {},
	});
	const res = createMockResponse();
	await adminHandler(req as any, res as any);
	return res;
};

const row = (over: Partial<NewznabIndexerRow> = {}): NewznabIndexerRow => ({
	prefix: 'tm',
	name: 'Treasure Maps',
	url: 'https://treasure-maps.com/api',
	apiKey: KEY,
	keyless: false,
	enabled: true,
	position: 0,
	pacingRate: null,
	pacingWindow: null,
	grabRate: 200,
	grabWindow: 86400,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	...over,
});

const originalToken = process.env.ADMIN_TOKEN;
const originalEnv = process.env.NEWZNAB_INDEXERS;

beforeEach(() => {
	process.env.ADMIN_TOKEN = TOKEN;
	delete process.env.NEWZNAB_INDEXERS;
	indexers._resetUpstreamIndexersForTest();
	vi.spyOn(NewznabIndexerService.prototype, 'getIndexer').mockResolvedValue(null);
});

afterEach(() => {
	vi.restoreAllMocks();
	process.env.ADMIN_TOKEN = originalToken;
	process.env.NEWZNAB_INDEXERS = originalEnv;
	indexers._resetUpstreamIndexersForTest();
});

describe('/api/newznab/admin', () => {
	it('refuses a missing or wrong token, and everything when no token is configured', async () => {
		const list = vi.spyOn(NewznabIndexerService.prototype, 'listIndexers');
		expect((await call({ method: 'GET' }, null))._getStatusCode()).toBe(401);
		expect((await call({ method: 'GET' }, 'wrong'))._getStatusCode()).toBe(401);
		delete process.env.ADMIN_TOKEN;
		expect((await call({ method: 'GET' }, ''))._getStatusCode()).toBe(401);
		expect(list).not.toHaveBeenCalled();
	});

	it('lists rows with only the end of each key', async () => {
		vi.spyOn(NewznabIndexerService.prototype, 'listIndexers').mockResolvedValue([row()]);
		const res = await call({ method: 'GET' });
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({
			source: 'database',
			indexers: [
				{
					prefix: 'tm',
					name: 'Treasure Maps',
					url: 'https://treasure-maps.com/api',
					keyHint: '…e08',
					keyless: false,
					enabled: true,
					position: 0,
					pacing: null,
					grabLimit: { rateLimit: 200, windowSeconds: 86400 },
				},
			],
		});
		expect(JSON.stringify(res._getData())).not.toContain(KEY);
	});

	it('shows the env list, keys hidden, while the table is empty', async () => {
		vi.spyOn(NewznabIndexerService.prototype, 'listIndexers').mockResolvedValue([]);
		process.env.NEWZNAB_INDEXERS = JSON.stringify([
			{ prefix: 'ng', name: 'NZBgeek', url: 'https://api.nzbgeek.info/api', apiKey: KEY },
		]);
		const res = await call({ method: 'GET' });
		expect(res._getData()).toMatchObject({
			source: 'environment',
			indexers: [{ prefix: 'ng', keyHint: '…e08', enabled: true }],
		});
		expect(JSON.stringify(res._getData())).not.toContain(KEY);
	});

	it('adds an indexer and clears the cached list', async () => {
		const create = vi
			.spyOn(NewznabIndexerService.prototype, 'createIndexer')
			.mockImplementation(async (data) => row(data));
		const invalidate = vi.spyOn(indexers, 'invalidateUpstreamIndexers');
		const res = await call({
			method: 'POST',
			body: {
				prefix: 'ng',
				name: ' NZBgeek ',
				url: 'https://api.nzbgeek.info/api/',
				apiKey: KEY,
				pacing: { rateLimit: 100, windowSeconds: 3600 },
				grabLimit: null,
			},
		});
		expect(res._getStatusCode()).toBe(201);
		expect(create).toHaveBeenCalledWith({
			prefix: 'ng',
			name: 'NZBgeek',
			url: 'https://api.nzbgeek.info/api',
			apiKey: KEY,
			keyless: false,
			enabled: true,
			position: 0,
			pacingRate: 100,
			pacingWindow: 3600,
			grabRate: null,
			grabWindow: null,
		});
		expect(invalidate).toHaveBeenCalled();
		expect(JSON.stringify(res._getData())).not.toContain(KEY);
	});

	it.each([
		[{ prefix: 'NG', name: 'x', url: 'https://x/api', apiKey: 'k' }, /prefix/],
		[{ prefix: 'a:b', name: 'x', url: 'https://x/api', apiKey: 'k' }, /prefix/],
		[{ prefix: 'ng', name: '', url: 'https://x/api', apiKey: 'k' }, /name/],
		[{ prefix: 'ng', name: 'x', url: 'ftp://x/api', apiKey: 'k' }, /URL/],
		[{ prefix: 'ng', name: 'x', url: 'not a url', apiKey: 'k' }, /URL/],
		[{ prefix: 'ng', name: 'x', url: 'https://x/api' }, /API key is required/],
		[
			{
				prefix: 'ng',
				name: 'x',
				url: 'https://x/api',
				apiKey: 'k',
				pacing: { rateLimit: 0, windowSeconds: 60 },
			},
			/Search pacing/,
		],
		[
			{
				prefix: 'ng',
				name: 'x',
				url: 'https://x/api',
				apiKey: 'k',
				grabLimit: { rateLimit: 5 },
			},
			/download limit/,
		],
	])('refuses %j', async (body, error) => {
		const create = vi.spyOn(NewznabIndexerService.prototype, 'createIndexer');
		const res = await call({ method: 'POST', body });
		expect(res._getStatusCode()).toBe(400);
		expect((res._getData() as { error: string }).error).toMatch(error);
		expect(create).not.toHaveBeenCalled();
	});

	it('accepts a keyless indexer without a key', async () => {
		vi.spyOn(NewznabIndexerService.prototype, 'createIndexer').mockImplementation(
			async (data) => row(data)
		);
		const res = await call({
			method: 'POST',
			body: {
				prefix: 'ato',
				name: 'AnimeTosho',
				url: 'https://feed.animetosho.org/api',
				keyless: true,
			},
		});
		expect(res._getStatusCode()).toBe(201);
	});

	it('never lets a new indexer take a prefix, even a disabled one', async () => {
		vi.spyOn(NewznabIndexerService.prototype, 'getIndexer').mockResolvedValue(
			row({ prefix: 'ng', enabled: false })
		);
		const create = vi.spyOn(NewznabIndexerService.prototype, 'createIndexer');
		const res = await call({
			method: 'POST',
			body: { prefix: 'ng', name: 'Other', url: 'https://other/api', apiKey: 'k' },
		});
		expect(res._getStatusCode()).toBe(409);
		expect(create).not.toHaveBeenCalled();
	});

	it('keeps the stored key when a change leaves the key field empty', async () => {
		vi.spyOn(NewznabIndexerService.prototype, 'getIndexer').mockResolvedValue(row());
		const update = vi
			.spyOn(NewznabIndexerService.prototype, 'updateIndexer')
			.mockImplementation(async (prefix, data) => row({ prefix, ...data }));
		const res = await call({
			method: 'PATCH',
			body: { prefix: 'tm', apiKey: '', enabled: false, grabLimit: null },
		});
		expect(res._getStatusCode()).toBe(200);
		expect(update).toHaveBeenCalledWith(
			'tm',
			expect.objectContaining({
				apiKey: KEY,
				enabled: false,
				grabRate: null,
				grabWindow: null,
			})
		);
		expect((res._getData() as { indexer: unknown }).indexer).toMatchObject({
			enabled: false,
			grabLimit: null,
		});
	});

	it('replaces the key when a new one is typed', async () => {
		vi.spyOn(NewznabIndexerService.prototype, 'getIndexer').mockResolvedValue(row());
		const update = vi
			.spyOn(NewznabIndexerService.prototype, 'updateIndexer')
			.mockImplementation(async (prefix, data) => row({ prefix, ...data }));
		await call({ method: 'PATCH', body: { prefix: 'tm', apiKey: 'new-key-000000000abc' } });
		expect(update).toHaveBeenCalledWith(
			'tm',
			expect.objectContaining({ apiKey: 'new-key-000000000abc' })
		);
	});

	it('answers 404 for a change to an unknown prefix', async () => {
		const res = await call({ method: 'PATCH', body: { prefix: 'zz', name: 'x' } });
		expect(res._getStatusCode()).toBe(404);
	});
});
