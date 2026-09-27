import type { AnimeEntryRow } from '@/services/database/anime';
import rows from '@/test/fixtures/anime/anime-rows-franchises.json';
import fribb from '@/test/fixtures/anime/fribb-franchises.json';
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { loadAnimeEntryLinks, loadAnimeFranchise, type AnimeEntrySources } from './animeEntries';
import { buildFranchiseIndex } from './animeFranchise';
import type { FribbAnimeEntry } from './animeMapping';
import { normalizeKitsuAnime } from './kitsu';

// The rows production's `Anime` table held on 2026-09-27 for these entries,
// and kitsu.io's answers to dmm-01 for the four seasons it had no row for.
const index = buildFranchiseIndex(fribb as FribbAnimeEntry[]);
const tableRows = rows as AnimeEntryRow[];

/** `getAnimeEntryRows`'s where clause, applied to the captured rows. */
const getRows = vi.fn(async ({ anidbIds, imdbIds }: { anidbIds: number[]; imdbIds: string[] }) =>
	tableRows.filter(
		(r) =>
			(r.anidb_id !== null && anidbIds.includes(r.anidb_id)) ||
			(r.imdb_id !== null && r.anidb_id !== null && imdbIds.includes(r.imdb_id))
	)
);

const FIXTURES = path.resolve(__dirname, '../../test/fixtures/anime');
const getKitsuLabel = vi.fn(async (kitsuId: number) => {
	try {
		const body = JSON.parse(
			readFileSync(path.join(FIXTURES, `kitsu-anime-${kitsuId}.json`), 'utf8')
		);
		const meta = normalizeKitsuAnime(body.data.attributes);
		return { title: meta.title, poster: meta.poster };
	} catch {
		return null;
	}
});

const sources: AnimeEntrySources = { index, getRows, getKitsuLabel };

describe('loadAnimeEntryLinks', () => {
	it('links a show to every AniDB entry filed under its IMDb id, titled by the table', async () => {
		const links = await loadAnimeEntryLinks(['tt10885406'], sources);

		expect(links.tt10885406.map((l) => [l.anidbId, l.type])).toEqual([
			[14727, 'TV'],
			[15293, 'TV'],
			[15300, 'OVA'],
			[15634, 'TV'],
			// The row says SPECIAL; the dataset and Kitsu say TV.
			[18302, 'TV'],
		]);
		expect(links.tt10885406[0].title).toBe(
			'Honzuki no Gekokujou: Shisho ni Naru Tame ni wa Shudan o Erande Iraremasen'
		);
		expect(links.tt10885406[4].title).toMatch(/Ryoushu no Youjo$/);
		expect(getKitsuLabel).not.toHaveBeenCalled();
	});

	it('labels the seasons the table has no row for from Kitsu', async () => {
		const links = await loadAnimeEntryLinks(['tt22248376', 'tt26743760'], sources);

		expect(links.tt22248376.map((l) => l.title)).toEqual([
			'Sousou no Frieren',
			'Sousou no Frieren 2nd Season',
			'Sousou no Frieren 3rd Season',
		]);
		expect(links.tt26743760.map((l) => l.title)).toEqual([
			'Kusuriya no Hitorigoto',
			'Kusuriya no Hitorigoto (2025)',
			'Kusuriya no Hitorigoto 3rd Season',
			'Kusuriya no Hitorigoto 3rd Season Part 2',
		]);
		expect(links.tt22248376[1].poster).toMatch(/^https:\/\/media\.kitsu\.app\//);
	});

	it('falls back to the AniDB id when Kitsu has nothing either', async () => {
		const links = await loadAnimeEntryLinks(['tt22248376'], {
			...sources,
			getKitsuLabel: undefined,
		});

		expect(links.tt22248376.map((l) => l.title)).toEqual([
			'Sousou no Frieren',
			'AniDB 18886',
			'AniDB 19977',
		]);
	});

	it('leaves out IMDb ids with no AniDB entry', async () => {
		const links = await loadAnimeEntryLinks(['tt0903747', 'tt22248376'], sources);

		expect(Object.keys(links)).toEqual(['tt22248376']);
	});

	// A failed dataset download must not cost the links the table can give.
	it("answers from the table's own IMDb ids when the dataset is unavailable", async () => {
		const links = await loadAnimeEntryLinks(['tt10885406'], { ...sources, index: null });

		expect(links.tt10885406.map((l) => [l.anidbId, l.type])).toEqual([[14727, 'TV']]);
	});
});

describe('loadAnimeFranchise', () => {
	it("gives Bookworm's fourth season its franchise and the show's IMDb id", async () => {
		const franchise = await loadAnimeFranchise(18302, sources);

		expect(franchise.known).toBe(true);
		// The row carries no imdb_id: the unique column gave it to season one.
		expect(tableRows.find((r) => r.anidb_id === 18302)?.imdb_id).toBeNull();
		expect(franchise.imdbIds).toEqual(['tt10885406']);
		expect(franchise.entries.map((e) => e.anidbId)).toEqual([
			14727, 15293, 15300, 15634, 18302,
		]);
	});

	it('is a franchise of one for an ONA with no IMDb id', async () => {
		const franchise = await loadAnimeFranchise(17052, sources);

		expect(franchise).toEqual({
			anidbId: 17052,
			known: true,
			imdbIds: [],
			entries: [
				{
					anidbId: 17052,
					title: 'Dou Po Cangqiong Nian Fan',
					type: 'ONA',
					poster: tableRows.find((r) => r.anidb_id === 17052)!.poster_url,
				},
			],
		});
	});

	it('knows nothing of an id neither source has', async () => {
		const franchise = await loadAnimeFranchise(99999999, sources);

		expect(franchise).toEqual({ anidbId: 99999999, known: false, imdbIds: [], entries: [] });
	});

	it('still answers for the entry itself when the dataset is unavailable', async () => {
		const franchise = await loadAnimeFranchise(17617, { ...sources, index: null });

		expect(franchise.known).toBe(true);
		expect(franchise.imdbIds).toEqual(['tt22248376']);
		expect(franchise.entries.map((e) => e.title)).toEqual(['Sousou no Frieren']);
	});
});
