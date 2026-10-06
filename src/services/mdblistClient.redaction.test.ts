// @vitest-environment node
import axios from 'axios';
import { readFileSync } from 'fs';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { join } from 'path';
import { format, inspect } from 'util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MDBListClient } from './mdblistClient';

// Fizzy #229. mdblist answers a bad key or a rate limit with HTTP 503 and the
// body in this fixture (captured 2026-10-06). axios throws on the 503, and the
// client logged that error whole when it fell back to a stale row, or rethrew it
// for its callers to log. An Axios error repeats the request URL, apikey and
// all, in `config.url` and in the raw request line.
const MDBLIST_503 = readFileSync(
	join(__dirname, '../test/fixtures/metadata/mdblist-503-invalid-key.json')
);

const KEY = 'mdblist-key-3c9e71';

const cache = vi.hoisted(() => ({
	getWithMetadata: vi.fn(),
	set: vi.fn(),
	cacheSearch: vi.fn(),
	cacheList: vi.fn(),
}));
vi.mock('./database/mdblistCache', () => ({ getMdblistCacheService: () => cache }));

let server: Server;
let origin = '';
const realGet = axios.get.bind(axios);

beforeAll(async () => {
	server = createServer((_req, res) => {
		res.writeHead(503, { 'content-type': 'application/json' });
		res.end(MDBLIST_503);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

let logged: string[] = [];

beforeEach(() => {
	logged = [];
	for (const level of ['log', 'warn', 'error'] as const) {
		vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
			logged.push(format(...args));
		});
	}
	// The client's own requests, through real axios and Node's http adapter, to
	// a stand-in that replays mdblist's answer byte for byte.
	vi.spyOn(axios, 'get').mockImplementation((url, config) =>
		realGet(String(url).replace('https://mdblist.com/api', `${origin}/api`), config)
	);
	cache.getWithMetadata.mockReset().mockResolvedValue(null);
	cache.set.mockReset().mockResolvedValue(undefined);
	cache.cacheSearch.mockReset().mockResolvedValue(undefined);
	cache.cacheList.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const staleRow = (data: unknown) => ({
	data,
	updatedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
});

const client = () => new MDBListClient(KEY);

const lookups: Array<[string, (c: MDBListClient) => Promise<unknown>, unknown]> = [
	['getInfoByImdbId', (c) => c.getInfoByImdbId('tt1046922'), { type: 'movie', title: 'Filth' }],
	['getInfoByTvdbId', (c) => c.getInfoByTvdbId(81189), { type: 'show', title: 'Breaking Bad' }],
	['getInfoByTmdbId', (c) => c.getInfoByTmdbId(111102), { type: 'show', title: 'Atlantic' }],
	['searchLists', (c) => c.searchLists('trending'), [{ id: 1 }]],
	['getListItems', (c) => c.getListItems('2194'), [{ id: 1 }]],
];

describe('MDBListClient keeps its key out of logs and rethrown errors', () => {
	it.each(lookups)(
		'%s serves a stale row on a 503 and logs the failure without the key',
		async (_name, call, row) => {
			cache.getWithMetadata.mockResolvedValue(staleRow(row));

			await expect(call(client())).resolves.toEqual(row);

			const lines = logged.join('\n');
			expect(lines).toMatch(/503/);
			expect(lines).not.toContain(KEY);
		}
	);

	it.each([
		...lookups.map(([name, call]) => [name, call] as const),
		['search', (c: MDBListClient) => c.search('filth')] as const,
		['getTopLists', (c: MDBListClient) => c.getTopLists()] as const,
	])('%s rethrows a 503 that a caller can log without the key', async (_name, call) => {
		const error: any = await call(client()).then(
			() => {
				throw new Error('expected the 503 to reject');
			},
			(rejection) => rejection
		);

		// What a caller's console.error(message, error) prints, and deeper.
		expect(format('lookup failed', error)).not.toContain(KEY);
		expect(inspect(error, { depth: 8 })).not.toContain(KEY);
		// Callers still branch on the status and the body.
		expect(axios.isAxiosError(error)).toBe(true);
		expect(error.response.status).toBe(503);
		expect(error.response.data.error).toBe('Invalid API key or Rate Limiter Reached!');
	});
});
