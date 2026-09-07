import { describe, expect, it, vi } from 'vitest';
import {
	FRIBB_ANIME_LIST_URL,
	fetchAnimeIdMappings,
	hasMatchableId,
	indexMappingsBy,
	normalizeFribbEntry,
	type FribbAnimeEntry,
} from './animeMapping';

const json = (body: unknown, ok = true, status = 200) =>
	vi.fn().mockResolvedValue({ ok, status, json: async () => body }) as unknown as typeof fetch;

// Shapes copied from the real dataset rather than invented.
const crestOfTheStars: FribbAnimeEntry = {
	type: 'TV',
	anidb_id: 1,
	'anime-planet_id': 'crest-of-the-stars',
	imdb_id: ['tt0286390'],
	kitsu_id: 265,
	mal_id: 290,
	simkl_id: 36462,
	themoviedb_id: { tv: 26209 },
	tvdb_id: 72025,
	season: { tvdb: 1, tmdb: 1 },
};

const galacticRailroad: FribbAnimeEntry = {
	type: 'MOVIE',
	anidb_id: 1250,
	'anime-planet_id': 'night-on-the-galactic-railroad',
	imdb_id: ['tt1920940', 'tt0089206'],
	kitsu_id: 1294,
	mal_id: 1441,
	themoviedb_id: { movie: [37585] },
};

describe('normalizeFribbEntry', () => {
	it('maps a fully populated TV entry', () => {
		expect(normalizeFribbEntry(crestOfTheStars)).toEqual({
			anidbId: 1,
			kitsuId: 265,
			malId: 290,
			animePlanetId: 'crest-of-the-stars',
			imdbId: 'tt0286390',
			tmdbId: 26209,
			tmdbType: 'tv',
			tvdbId: 72025,
			simklId: 36462,
			type: 'TV',
		});
	});

	it('drops an ambiguous imdb id rather than picking one', () => {
		// Anime.imdb_id is @unique, so claiming tt1920940 here would steal the id
		// from whichever title actually owns it.
		const mapping = normalizeFribbEntry(galacticRailroad);
		expect(mapping.imdbId).toBeNull();
		expect(mapping.anidbId).toBe(1250);
	});

	it('reads the single-element movie form of themoviedb_id', () => {
		const mapping = normalizeFribbEntry(galacticRailroad);
		expect(mapping.tmdbId).toBe(37585);
		expect(mapping.tmdbType).toBe('movie');
	});

	it('drops a multi-valued movie tmdb id', () => {
		const mapping = normalizeFribbEntry({ mal_id: 5, themoviedb_id: { movie: [1, 2] } });
		expect(mapping.tmdbId).toBeNull();
		expect(mapping.tmdbType).toBeNull();
	});

	it('returns nulls for an entry with no ids at all', () => {
		const mapping = normalizeFribbEntry({});
		expect(mapping).toEqual({
			anidbId: null,
			kitsuId: null,
			malId: null,
			animePlanetId: null,
			imdbId: null,
			tmdbId: null,
			tmdbType: null,
			tvdbId: null,
			simklId: null,
			type: null,
		});
	});

	it('rejects zero, negative and non-integer ids', () => {
		const mapping = normalizeFribbEntry({
			anidb_id: 0,
			kitsu_id: -3,
			mal_id: 1.5 as number,
		});
		expect(mapping.anidbId).toBeNull();
		expect(mapping.kitsuId).toBeNull();
		expect(mapping.malId).toBeNull();
	});

	it('rejects an imdb id that is not a tt-prefixed id', () => {
		expect(normalizeFribbEntry({ mal_id: 1, imdb_id: ['unknown'] }).imdbId).toBeNull();
		expect(normalizeFribbEntry({ mal_id: 1, imdb_id: [''] }).imdbId).toBeNull();
	});

	it('trims an anime-planet slug and drops a blank one', () => {
		expect(normalizeFribbEntry({ 'anime-planet_id': '  slug  ' }).animePlanetId).toBe('slug');
		expect(normalizeFribbEntry({ 'anime-planet_id': '   ' }).animePlanetId).toBeNull();
	});
});

describe('hasMatchableId', () => {
	it('accepts an entry carrying any matchable id', () => {
		expect(hasMatchableId(normalizeFribbEntry({ mal_id: 290 }))).toBe(true);
		expect(hasMatchableId(normalizeFribbEntry({ 'anime-planet_id': 'x' }))).toBe(true);
	});

	it('rejects an entry that only carries ids we cannot match a row on', () => {
		// tvdb/simkl/imdb alone cannot find an existing Anime row.
		expect(hasMatchableId(normalizeFribbEntry({ tvdb_id: 72025, imdb_id: ['tt1'] }))).toBe(
			false
		);
	});
});

describe('fetchAnimeIdMappings', () => {
	it('normalizes and filters the dataset', async () => {
		const fetcher = json([crestOfTheStars, {}, { tvdb_id: 99 }]);
		const mappings = await fetchAnimeIdMappings(fetcher);

		expect(fetcher).toHaveBeenCalledWith(FRIBB_ANIME_LIST_URL);
		expect(mappings).toHaveLength(1);
		expect(mappings[0].anidbId).toBe(1);
	});

	it('throws on a non-ok response', async () => {
		await expect(fetchAnimeIdMappings(json([], false, 503))).rejects.toThrow(
			'Fribb anime-lists fetch failed: 503'
		);
	});

	it('throws when the payload is not an array', async () => {
		await expect(fetchAnimeIdMappings(json({ nope: true }))).rejects.toThrow(
			'did not return an array'
		);
	});
});

describe('indexMappingsBy', () => {
	it('groups every mapping that shares an id', () => {
		// Two seasons of one show share a tvdb id but differ by anidb id; the
		// reverse happens too, so a key must not silently keep only the last.
		const mappings = [
			normalizeFribbEntry({ anidb_id: 2, mal_id: 300, imdb_id: ['tt0102847'] }),
			normalizeFribbEntry({ anidb_id: 3, mal_id: 300, imdb_id: ['tt0102847'] }),
		];
		const byMal = indexMappingsBy(mappings, 'malId');

		expect(byMal.get(300)).toHaveLength(2);
		expect(byMal.get(300)?.map((m) => m.anidbId)).toEqual([2, 3]);
	});

	it('skips mappings without the indexed id', () => {
		const mappings = [normalizeFribbEntry({ mal_id: 1 })];
		expect(indexMappingsBy(mappings, 'anidbId').size).toBe(0);
	});
});
