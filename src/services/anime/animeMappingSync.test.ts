import conflicting from '@/test/fixtures/anime/fribb-conflicting-ids.json';
import sharedImdb from '@/test/fixtures/anime/fribb-shared-imdb.json';
import { describe, expect, it } from 'vitest';
import { normalizeFribbEntry, type FribbAnimeEntry } from './animeMapping';
import {
	backupRowsFor,
	planAnimeMappingUpdates,
	summarizePlan,
	type AnimeRow,
} from './animeMappingSync';

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
				kitsu_id: 265,
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
	});

	it('neither overwrites nor fills from an entry one of the row ids contradicts', () => {
		// Matched on mal 290, but the row's kitsu 265 says it is another title.
		const rows = [row({ id: 1, mal_id: 290, kitsu_id: 265 })];
		const mappings = [
			normalizeFribbEntry({
				mal_id: 290,
				kitsu_id: 999,
				anidb_id: 1,
				imdb_id: ['tt0286390'],
			}),
		];

		const plan = planAnimeMappingUpdates(rows, mappings);

		expect(plan.updates).toEqual([]);
		expect(plan.conflictingRows).toBe(1);
		expect(plan.matchedRows).toBe(0);
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

// Real rows from production and every Fribb entry that indexes to one of their
// ids (commit 8e4ec6a2). Each of the first three is matched on one id while
// another of its own ids belongs to a different entry.
describe('planAnimeMappingUpdates against rows whose ids disagree', () => {
	const rows = conflicting.rows as AnimeRow[];
	const plan = planAnimeMappingUpdates(
		rows,
		(conflicting.fribb as FribbAnimeEntry[]).map(normalizeFribbEntry)
	);
	const update = (title: string) =>
		plan.updates.find((u) => u.id === conflicting.rows.find((r) => r.title === title)!.id);

	it.each([
		// kitsu 48382 is anidb 19021's, but the row's mal 49982 and its
		// anime-planet slug both belong to anidb 17512.
		['Geu Yeoreum'],
		// anidb 9168 is mal 21121's entry; the row's mal 58181 is another one.
		['Heart Cocktail Again'],
		// kitsu 46490 is a mal-63522 special; the row is the mal-53053 series.
		['Genshin Impact'],
	])('leaves %s alone rather than fill it from the wrong entry', (title) => {
		expect(update(title)).toBeUndefined();
	});

	it('counts them, so a dry run says how many it refused', () => {
		expect(plan.conflictingRows).toBe(3);
		expect(summarizePlan(plan).conflictingRows).toBe(3);
	});

	// anime-planet renames its slugs; every numeric id still agrees here.
	it('still fills a row whose only disagreement is a renamed slug', () => {
		expect(update('Ameku Takao no Suiri Karte')?.fields).toEqual({ imdb_id: 'tt33384314' });
	});

	it('still fills a row whose ids all agree', () => {
		expect(update('Sousou no Frieren')?.fields).toEqual({ imdb_id: 'tt22248376' });
	});
});

// Several dataset entries name one IMDb title, and `Anime.imdb_id` is unique,
// so one row gets it. Real rows and entries: seven .hack// titles share
// tt0361140 and A3!'s two seasons share tt11094154.
describe('planAnimeMappingUpdates when several rows claim one imdb id', () => {
	const rows = sharedImdb.rows as (AnimeRow & { title: string })[];
	const mappings = (sharedImdb.fribb as FribbAnimeEntry[]).map(normalizeFribbEntry);
	const owner = (plan: ReturnType<typeof planAnimeMappingUpdates>, imdbId: string) =>
		rows.find((r) => r.id === plan.updates.find((u) => u.fields.imdb_id === imdbId)?.id)?.title;

	it("gives it to the show's first season, not whichever row sorts first", () => {
		const plan = planAnimeMappingUpdates(rows, mappings);

		// Row 18 is ".hack//G.U. Returner", an OVA; row 141 is A3!'s second season.
		expect(owner(plan, 'tt0361140')).toBe('.hack//Sign');
		expect(owner(plan, 'tt11094154')).toBe('A3! Season Spring & Summer');
	});

	it('does not depend on the order the rows were read in', () => {
		const plan = planAnimeMappingUpdates([...rows].reverse(), mappings);

		expect(owner(plan, 'tt0361140')).toBe('.hack//Sign');
		expect(owner(plan, 'tt11094154')).toBe('A3! Season Spring & Summer');
	});

	it('still counts every other claimant as a collision', () => {
		const plan = planAnimeMappingUpdates(rows, mappings);

		expect(plan.collisions.imdb_id).toBe(rows.length - 2);
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

describe('backupRowsFor', () => {
	it('records every syncable column of exactly the rows the plan writes', () => {
		const rows = conflicting.rows as (AnimeRow & { title: string })[];
		const plan = planAnimeMappingUpdates(
			rows,
			(conflicting.fribb as FribbAnimeEntry[]).map(normalizeFribbEntry)
		);

		const backup = backupRowsFor(plan, rows);

		expect(backup.map((b) => b.id).sort()).toEqual(plan.updates.map((u) => u.id).sort());
		const frieren = rows.find((r) => r.title === 'Sousou no Frieren')!;
		expect(backup.find((b) => b.id === frieren.id)).toEqual({
			id: frieren.id,
			anidb_id: 17617,
			kitsu_id: 46474,
			mal_id: 52991,
			anime_planet_id: 'frieren-beyond-journeys-end',
			imdb_id: null,
		});
		// Titles and other columns the sync never writes stay out of it.
		expect(Object.keys(backup[0]).sort()).toEqual(
			['anidb_id', 'anime_planet_id', 'id', 'imdb_id', 'kitsu_id', 'mal_id'].sort()
		);
	});
});
