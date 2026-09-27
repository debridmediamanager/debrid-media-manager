import fribb from '@/test/fixtures/anime/fribb-franchises.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildFranchiseIndex,
	entriesForImdb,
	franchiseOf,
	getFranchiseIndex,
	resetFranchiseIndexForTests,
} from './animeFranchise';
import type { FribbAnimeEntry } from './animeMapping';

// Every entry of the Fribb dataset at commit 8e4ec6a2 that names Bookworm's,
// Frieren's or Apothecary's IMDb id, plus the two no-IMDb ONAs, three entries
// naming `""`, one naming two IMDb ids and one with no AniDB id.
const raw = fribb as FribbAnimeEntry[];
const ids = (entries: { anidbId: number }[]) => entries.map((e) => e.anidbId);

describe('buildFranchiseIndex', () => {
	const index = buildFranchiseIndex(raw);

	it("lists Bookworm's five AniDB entries under its one IMDb id, oldest first", () => {
		expect(ids(entriesForImdb(index, 'tt10885406'))).toEqual([
			14727, 15293, 15300, 15634, 18302,
		]);
		expect(entriesForImdb(index, 'tt10885406').map((e) => e.type)).toEqual([
			'TV',
			'TV',
			'OVA',
			'TV',
			'TV',
		]);
	});

	it("lists Frieren's and Apothecary's seasons the same way", () => {
		expect(ids(entriesForImdb(index, 'tt22248376'))).toEqual([17617, 18886, 19977]);
		expect(ids(entriesForImdb(index, 'tt26743760'))).toEqual([17870, 18562, 19444, 19671]);
	});

	// 37 entries in the dataset name "" as their IMDb id; read as an id, they
	// would make one franchise of unrelated OVAs, films and TV series.
	it('does not treat an empty IMDb id as a shared one', () => {
		expect(index.byImdb.has('')).toBe(false);
		expect(franchiseOf(index, 205).map((e) => e.anidbId)).toEqual([205]);
		expect(index.byAnidb.get(759)?.imdbIds).toEqual([]);
	});

	it('keeps both IMDb ids of an entry that names two', () => {
		expect(index.byAnidb.get(1250)?.imdbIds).toEqual(['tt1920940', 'tt0089206']);
	});

	it('skips entries with no AniDB id', () => {
		const withoutAnidb = raw.filter((e) => !e.anidb_id).length;
		expect(withoutAnidb).toBe(1);
		expect(index.byAnidb.size).toBe(raw.length - withoutAnidb);
	});

	it('carries the Kitsu id the info route uses for entries the table lacks', () => {
		expect(index.byAnidb.get(18886)).toMatchObject({ kitsuId: 49240, type: 'TV' });
	});
});

describe('franchiseOf', () => {
	const index = buildFranchiseIndex(raw);

	it('answers the same franchise from any of its entries', () => {
		const fromFirst = ids(franchiseOf(index, 14727));
		expect(fromFirst).toEqual([14727, 15293, 15300, 15634, 18302]);
		expect(ids(franchiseOf(index, 18302))).toEqual(fromFirst);
		expect(ids(franchiseOf(index, 15300))).toEqual(fromFirst);
	});

	it('is the entry alone when it has no IMDb id', () => {
		expect(ids(franchiseOf(index, 17052))).toEqual([17052]);
		expect(ids(franchiseOf(index, 13789))).toEqual([13789]);
	});

	it('is empty for an id the dataset does not have', () => {
		expect(franchiseOf(index, 99999999)).toEqual([]);
	});
});

describe('getFranchiseIndex', () => {
	beforeEach(() => {
		resetFranchiseIndexForTests();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	const answering = (body: unknown, ok = true) =>
		vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => body }) as Response);

	it('downloads once and answers later calls from memory', async () => {
		const fetcher = answering(raw);

		const [a, b] = await Promise.all([getFranchiseIndex(fetcher), getFranchiseIndex(fetcher)]);
		const c = await getFranchiseIndex(fetcher);

		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(a).toBe(b);
		expect(c).toBe(a);
		expect(ids(entriesForImdb(a!, 'tt22248376'))).toEqual([17617, 18886, 19977]);
	});

	it('answers null rather than an empty index when the download fails', async () => {
		const fetcher = answering(null, false);

		expect(await getFranchiseIndex(fetcher)).toBeNull();
		// And does not retry on every request while GitHub is down.
		expect(await getFranchiseIndex(fetcher)).toBeNull();
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});
