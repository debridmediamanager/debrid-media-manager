import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getSimklClientId,
	isSimklConfigured,
	lookupSimklIds,
	normalizeSimklIds,
	resolveImdbIdFromSimkl,
} from './simkl';

const respond = (body: unknown, ok = true) =>
	vi.fn().mockResolvedValue({
		ok,
		status: ok ? 200 : 412,
		json: async () => body,
	}) as unknown as typeof fetch;

describe('Simkl configuration', () => {
	const saved = process.env.SIMKL_CLIENT_ID;

	beforeEach(() => {
		delete process.env.SIMKL_CLIENT_ID;
	});

	afterEach(() => {
		if (saved === undefined) delete process.env.SIMKL_CLIENT_ID;
		else process.env.SIMKL_CLIENT_ID = saved;
	});

	it('reports unconfigured when the client id is absent or blank', () => {
		expect(getSimklClientId()).toBeNull();
		expect(isSimklConfigured()).toBe(false);
		process.env.SIMKL_CLIENT_ID = '   ';
		expect(isSimklConfigured()).toBe(false);
	});

	it('reports configured once a client id is set', () => {
		process.env.SIMKL_CLIENT_ID = 'abc123';
		expect(getSimklClientId()).toBe('abc123');
		expect(isSimklConfigured()).toBe(true);
	});

	it('makes no request at all when unconfigured', async () => {
		// Every Simkl endpoint answers 412 without a client id, so calling out
		// would be a guaranteed wasted round trip.
		const fetcher = respond([]);
		expect(await lookupSimklIds('anidb', 1, fetcher)).toBeNull();
		expect(fetcher).not.toHaveBeenCalled();
	});
});

describe('normalizeSimklIds', () => {
	it('maps the ids Simkl returns', () => {
		expect(
			normalizeSimklIds({
				simkl: 36462,
				imdb: 'tt0213338',
				tmdb: '26209',
				tvdb: 72025,
				mal: 290,
				anidb: 1,
			})
		).toEqual({
			simkl: 36462,
			imdb: 'tt0213338',
			tmdb: 26209,
			tvdb: 72025,
			mal: 290,
			anidb: 1,
		});
	});

	it('accepts simkl_id as an alias', () => {
		expect(normalizeSimklIds({ simkl_id: 5 })?.simkl).toBe(5);
	});

	it('rejects a malformed imdb id', () => {
		expect(normalizeSimklIds({ imdb: 'nope', mal: 1 })?.imdb).toBeNull();
		expect(normalizeSimklIds({ imdb: '', mal: 1 })?.imdb).toBeNull();
	});

	it('returns null when nothing resolved', () => {
		expect(normalizeSimklIds({})).toBeNull();
		expect(normalizeSimklIds(undefined)).toBeNull();
		expect(normalizeSimklIds({ imdb: 'bad', tmdb: 0 })).toBeNull();
	});
});

describe('lookupSimklIds', () => {
	const saved = process.env.SIMKL_CLIENT_ID;

	beforeEach(() => {
		process.env.SIMKL_CLIENT_ID = 'client-id';
	});

	afterEach(() => {
		if (saved === undefined) delete process.env.SIMKL_CLIENT_ID;
		else process.env.SIMKL_CLIENT_ID = saved;
	});

	it('queries by the requested external id and returns the first usable match', async () => {
		const fetcher = respond([{ ids: { anidb: 1, imdb: 'tt0213338' } }]);
		const ids = await lookupSimklIds('anidb', 1, fetcher);

		const [url] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toContain('/search/id?anidb=1');
		expect(url).toContain('client_id=client-id');
		expect(ids?.imdb).toBe('tt0213338');
	});

	it('skips entries that resolved nothing', async () => {
		const fetcher = respond([{ ids: {} }, { ids: { imdb: 'tt0000001' } }]);
		expect((await lookupSimklIds('mal', 290, fetcher))?.imdb).toBe('tt0000001');
	});

	it('returns null on a non-ok response', async () => {
		expect(await lookupSimklIds('anidb', 1, respond([], false))).toBeNull();
	});

	it('returns null for an empty or non-array payload', async () => {
		expect(await lookupSimklIds('anidb', 1, respond([]))).toBeNull();
		expect(await lookupSimklIds('anidb', 1, respond({ error: 'nope' }))).toBeNull();
	});

	it('returns null when the request throws', async () => {
		const fetcher = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
		expect(await lookupSimklIds('anidb', 1, fetcher)).toBeNull();
	});

	it('returns null for a blank id without requesting', async () => {
		const fetcher = respond([]);
		expect(await lookupSimklIds('anidb', '  ', fetcher)).toBeNull();
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('url-encodes the id', async () => {
		const fetcher = respond([]);
		await lookupSimklIds('imdb', 'tt 123', fetcher);
		const [url] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toContain('imdb=tt%20123');
	});
});

describe('resolveImdbIdFromSimkl', () => {
	const saved = process.env.SIMKL_CLIENT_ID;

	beforeEach(() => {
		process.env.SIMKL_CLIENT_ID = 'client-id';
	});

	afterEach(() => {
		if (saved === undefined) delete process.env.SIMKL_CLIENT_ID;
		else process.env.SIMKL_CLIENT_ID = saved;
	});

	it('returns the imdb id when one is found', async () => {
		const fetcher = respond([{ ids: { imdb: 'tt0213338' } }]);
		expect(await resolveImdbIdFromSimkl('kitsu', 1, fetcher)).toBe('tt0213338');
	});

	it('returns null when the match carries no imdb id', async () => {
		const fetcher = respond([{ ids: { mal: 290 } }]);
		expect(await resolveImdbIdFromSimkl('kitsu', 1, fetcher)).toBeNull();
	});
});
