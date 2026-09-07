import { describe, expect, it } from 'vitest';
import { normalizeFribbEntry } from './animeMapping';
import { planAnimeMappingUpdates, summarizePlan, type AnimeRow } from './animeMappingSync';

const row = (over: Partial<AnimeRow> & { id: number }): AnimeRow => ({
	anidb_id: null,
	kitsu_id: null,
	mal_id: null,
	anime_planet_id: null,
	imdb_id: null,
	...over,
});

describe('planAnimeMappingUpdates', () => {
	it('fills only the columns that are null', () => {
		const rows = [row({ id: 1, mal_id: 290, kitsu_id: 265 })];
		const mappings = [
			normalizeFribbEntry({
				mal_id: 290,
				kitsu_id: 999,
				anidb_id: 1,
				imdb_id: ['tt0286390'],
				'anime-planet_id': 'crest-of-the-stars',
			}),
		];

		const plan = planAnimeMappingUpdates(rows, mappings);

		expect(plan.updates).toEqual([
			{
				id: 1,
				fields: {
					anidb_id: 1,
					anime_planet_id: 'crest-of-the-stars',
					imdb_id: 'tt0286390',
				},
			},
		]);
		// kitsu_id was already 265 and is not overwritten with the dataset's 999.
		expect(plan.updates[0].fields.kitsu_id).toBeUndefined();
	});

	it('does not write an imdb id another row already owns', () => {
		const rows = [
			row({ id: 1, mal_id: 300, imdb_id: 'tt0102847' }),
			row({ id: 2, mal_id: 301 }),
		];
		const mappings = [
			normalizeFribbEntry({ mal_id: 300, imdb_id: ['tt0102847'] }),
			normalizeFribbEntry({ mal_id: 301, imdb_id: ['tt0102847'] }),
		];

		const plan = planAnimeMappingUpdates(rows, mappings);

		expect(plan.updates).toEqual([]);
		expect(plan.collisions.imdb_id).toBe(1);
	});

	it('does not hand the same new id to two rows in one run', () => {
		const rows = [row({ id: 1, mal_id: 300 }), row({ id: 2, mal_id: 301 })];
		const mappings = [
			normalizeFribbEntry({ mal_id: 300, imdb_id: ['tt0102847'] }),
			normalizeFribbEntry({ mal_id: 301, imdb_id: ['tt0102847'] }),
		];

		const plan = planAnimeMappingUpdates(rows, mappings);

		expect(plan.updates).toEqual([{ id: 1, fields: { imdb_id: 'tt0102847' } }]);
		expect(plan.collisions.imdb_id).toBe(1);
	});

	it('skips a row whose id matches more than one dataset entry', () => {
		// Two seasons share a mal id; merging either one's imdb id into the row
		// would attribute the wrong season to it.
		const rows = [row({ id: 1, mal_id: 300 })];
		const mappings = [
			normalizeFribbEntry({ mal_id: 300, anidb_id: 2, imdb_id: ['tt0102847'] }),
			normalizeFribbEntry({ mal_id: 300, anidb_id: 3, imdb_id: ['tt0102848'] }),
		];

		const plan = planAnimeMappingUpdates(rows, mappings);

		expect(plan.updates).toEqual([]);
		expect(plan.ambiguousRows).toBe(1);
		expect(plan.matchedRows).toBe(0);
	});

	it('prefers the anidb id over the mal id when both match', () => {
		const rows = [row({ id: 1, anidb_id: 1, mal_id: 290 })];
		const mappings = [
			normalizeFribbEntry({ anidb_id: 1, imdb_id: ['tt0000001'] }),
			normalizeFribbEntry({ mal_id: 290, imdb_id: ['tt0000002'] }),
		];

		const plan = planAnimeMappingUpdates(rows, mappings);

		expect(plan.updates[0].fields.imdb_id).toBe('tt0000001');
	});

	it('matches on the anime-planet slug when no numeric id matches', () => {
		const rows = [row({ id: 1, anime_planet_id: 'crest-of-the-stars' })];
		const mappings = [
			normalizeFribbEntry({
				'anime-planet_id': 'crest-of-the-stars',
				mal_id: 290,
				imdb_id: ['tt0286390'],
			}),
		];

		const plan = planAnimeMappingUpdates(rows, mappings);

		expect(plan.updates).toEqual([{ id: 1, fields: { mal_id: 290, imdb_id: 'tt0286390' } }]);
	});

	it('leaves an unmatched row alone', () => {
		const plan = planAnimeMappingUpdates(
			[row({ id: 1, mal_id: 7 })],
			[normalizeFribbEntry({ mal_id: 8, imdb_id: ['tt1'] })]
		);

		expect(plan.updates).toEqual([]);
		expect(plan.matchedRows).toBe(0);
	});

	it('produces no update when the mapping adds nothing new', () => {
		const rows = [row({ id: 1, mal_id: 290, imdb_id: 'tt0286390' })];
		const mappings = [normalizeFribbEntry({ mal_id: 290, imdb_id: ['tt0286390'] })];

		const plan = planAnimeMappingUpdates(rows, mappings);

		expect(plan.matchedRows).toBe(1);
		expect(plan.updates).toEqual([]);
	});
});

describe('summarizePlan', () => {
	it('counts the rows each column would fill', () => {
		const rows = [row({ id: 1, mal_id: 290 }), row({ id: 2, mal_id: 291 })];
		const mappings = [
			normalizeFribbEntry({ mal_id: 290, anidb_id: 1, imdb_id: ['tt1'] }),
			normalizeFribbEntry({ mal_id: 291, anidb_id: 2 }),
		];

		expect(summarizePlan(planAnimeMappingUpdates(rows, mappings))).toMatchObject({
			rowsToUpdate: 2,
			matchedRows: 2,
			ambiguousRows: 0,
			anidb_id: 2,
			imdb_id: 1,
		});
	});
});
