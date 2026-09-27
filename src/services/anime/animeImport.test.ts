import tableRows from '@/test/fixtures/anime/anime-rows-import.json';
import fribbEntries from '@/test/fixtures/anime/fribb-import-entries.json';
import kitsuBatch from '@/test/fixtures/anime/kitsu-import-batch.json';
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { aliasesFor, parseAnidbTitles, shouldDownloadAnidbDump } from './anidbTitles';
import {
	backupFor,
	clipTitle,
	fitUrl,
	planAnimeImport,
	selectAnimeImportWork,
	type AnimeImportRow,
} from './animeImport';
import { isAdultEntry, parseAnimeLists, typeFromAnimeLists } from './animeLists';
import { hasMatchableId, normalizeFribbEntry, type FribbAnimeEntry } from './animeMapping';
import { normalizeKitsuImport, type KitsuImportMeta } from './kitsu';

const FIXTURES = join(__dirname, '../../test/fixtures/anime');
const anidb = parseAnidbTitles(readFileSync(join(FIXTURES, 'anidb-titles-excerpt.dat'), 'utf8'));
const animeLists = parseAnimeLists(readFileSync(join(FIXTURES, 'anime-lists-excerpt.xml'), 'utf8'));
const mappings = (fribbEntries as FribbAnimeEntry[])
	.map(normalizeFribbEntry)
	.filter(hasMatchableId);
const rows = tableRows as unknown as AnimeImportRow[];
const kitsu = new Map<number, KitsuImportMeta>(
	kitsuBatch.data
		.map((entry) => normalizeKitsuImport(entry as any))
		.filter((meta): meta is KitsuImportMeta => meta !== null)
		.map((meta) => [meta.kitsuId, meta])
);

const run = (kitsuMetas = kitsu) => {
	const work = selectAnimeImportWork({ rows, anidb, animeLists, mappings });
	return { work, plan: planAnimeImport(work, { rows, anidb, mappings, kitsu: kitsuMetas }) };
};
const insertFor = (plan: ReturnType<typeof run>['plan'], aid: number) =>
	plan.inserts.find((insert) => insert.anidb_id === aid);

describe('parseAnidbTitles', () => {
	it('reads every entry of the dump excerpt with its primary title', () => {
		expect(anidb.size).toBe(11);
		expect(anidb.get(17617)?.primary).toBe('Sousou no Frieren');
		expect(anidb.get(18886)?.primary).toBe('Sousou no Frieren (2026)');
	});

	it('lists the primary title first, then English, romaji and Japanese official titles', () => {
		const aliases = aliasesFor(anidb.get(17617)!);
		expect(aliases.slice(0, 3)).toEqual([
			'Sousou no Frieren',
			'Frieren: Beyond Journey`s End',
			'葬送のフリーレン',
		]);
		expect(new Set(aliases).size).toBe(aliases.length);
	});
});

describe('shouldDownloadAnidbDump', () => {
	const at = (iso: string) => Date.parse(iso);

	it('downloads when there has never been an attempt', () => {
		expect(shouldDownloadAnidbDump(null, at('2026-09-27T05:17:00Z'))).toBe(true);
	});

	it('downloads once a day for a cron that fires at the same minute', () => {
		expect(
			shouldDownloadAnidbDump(at('2026-09-27T05:17:03Z'), at('2026-09-28T05:17:00Z'))
		).toBe(true);
	});

	it('reads the cache for a second run the same day, even a failed attempt', () => {
		expect(
			shouldDownloadAnidbDump(at('2026-09-27T05:17:00Z'), at('2026-09-27T23:59:00Z'))
		).toBe(false);
	});

	it('reads the cache just after midnight when the last attempt was late the day before', () => {
		expect(
			shouldDownloadAnidbDump(at('2026-09-27T23:30:00Z'), at('2026-09-28T01:00:00Z'))
		).toBe(false);
	});
});

describe('parseAnimeLists', () => {
	it('carries AniDB’s adult flag and the entry kind in tvdbid', () => {
		expect(animeLists.size).toBe(11);
		expect(isAdultEntry(animeLists.get(18756))).toBe(true);
		expect(isAdultEntry(animeLists.get(17617))).toBe(false);
		expect(animeLists.get(17617)?.defaultTvdbSeason).toBe(1);
		expect(typeFromAnimeLists(animeLists.get(17617))).toBeNull();
	});
});

describe('selectAnimeImportWork', () => {
	it('names every missing entry and why it cannot be inserted yet', () => {
		const { work } = run();
		expect(work.counts).toMatchObject({
			anidbEntries: 11,
			tableRows: 4,
			// Frieren and the two rows with anidb ids are present.
			missingAids: 8,
			skippedAdult: 1, // 18756, tvdbid="hentai"
			skippedNoMapping: 1, // 20419, added to AniDB after Fribb's last build
			skippedNoKitsuId: 1, // 20331, mapped to MAL but not to Kitsu
		});
		expect(work.candidates.map((c) => c.aid)).toEqual([18700, 18729, 18886, 19067, 19972]);
	});

	it('asks Kitsu for the candidates and for the rows missing a title or poster', () => {
		const { work } = run();
		expect(work.enrichTargets.map((row) => row.id).sort()).toEqual([11867, 15346, 16587]);
		expect(work.kitsuIds).toEqual([48981, 49008, 49090, 49240, 49433, 49759, 50626]);
	});
});

describe('planAnimeImport', () => {
	it('inserts a missing 2026 season with its AniDB title and Kitsu metadata', () => {
		const { plan } = run();
		const frierenS2 = insertFor(plan, 18886);

		expect(frierenS2).toMatchObject({
			anidb_id: 18886,
			kitsu_id: 49240,
			mal_id: 59978,
			anime_planet_id: 'frieren-beyond-journeys-end-season-2',
			title: 'Sousou no Frieren (2026)',
			type: 'TV',
			startDate: '2026-01-16',
		});
		expect(frierenS2!.poster_url).toMatch(
			/^https:\/\/media\.kitsu\.app\/anime\/49240\/poster_image\/medium-/
		);
		expect(frierenS2!.description).not.toBe('');
		expect(frierenS2!.aliases[0]).toBe('Sousou no Frieren (2026)');
	});

	it('leaves a shared imdb id with the row that holds it', () => {
		// Frieren's second season names tt22248376, which the first season's row owns.
		const { plan } = run();
		expect(insertFor(plan, 18886)!.imdb_id).toBeNull();
		expect(plan.updates.find((u) => u.id === 11142)).toBeUndefined();
	});

	it('gives an imdb id three new seasons share to the first season', () => {
		const { plan } = run();
		expect(insertFor(plan, 18700)!.imdb_id).toBe('tt32766897');
		expect(insertFor(plan, 19067)!.imdb_id).toBeNull();
		expect(insertFor(plan, 19972)!.imdb_id).toBeNull();
		expect(plan.collisions.imdb_id).toBe(3);
	});

	it('does not insert an entry whose only Kitsu poster is a presigned URL too long to store', () => {
		// Kitsu answered 49008 with a 396-character Backblaze link that expires.
		const { plan } = run();
		expect(kitsu.get(49008)!.poster.length).toBeGreaterThan(191);
		expect(insertFor(plan, 18729)).toBeUndefined();
		expect(plan.counts.kitsuNoPoster).toBe(1);
	});

	it('does not insert an entry Kitsu did not return, and lets its imdb id go to the next season', () => {
		const withoutRanma = new Map(kitsu);
		withoutRanma.delete(48981);
		const { plan } = run(withoutRanma);

		expect(insertFor(plan, 18700)).toBeUndefined();
		expect(plan.counts.kitsuAbsent).toBe(1);
		expect(insertFor(plan, 19067)!.imdb_id).toBe('tt32766897');
	});

	it('does not insert an entry Kitsu marks as adult', () => {
		const adult = new Map(kitsu);
		adult.set(49240, { ...kitsu.get(49240)!, ageRating: 'R18' });
		const { plan } = run(adult);

		expect(insertFor(plan, 18886)).toBeUndefined();
		expect(plan.counts.kitsuAdult).toBe(1);
	});

	it('fills a missing poster without touching the title a row already has', () => {
		const { plan } = run();
		const thunderbolt = plan.updates.find((u) => u.id === 11867)!;

		expect(thunderbolt.fields.title).toBeUndefined();
		expect(thunderbolt.fields.poster_url).toMatch(/\/anime\/49090\/poster_image\/medium-/);
	});

	it('titles a row from AniDB when it has an anidb id and no Kitsu id', () => {
		const { plan } = run();
		expect(plan.updates.find((u) => u.id === 16587)!.fields).toEqual({
			title: 'Climbing',
			aliases: ['Climbing', '클라이밍'],
		});
	});

	it('titles a Kitsu-only row from Kitsu', () => {
		const { plan } = run();
		expect(plan.updates.find((u) => u.id === 15346)!.fields.title).toBe('Beyond Meta');
	});

	it('never writes a unique value twice or one a row already holds', () => {
		const { plan } = run();
		for (const column of [
			'anidb_id',
			'kitsu_id',
			'mal_id',
			'anime_planet_id',
			'imdb_id',
		] as const) {
			const held = new Set(rows.map((row) => row[column]).filter((v) => v !== null));
			const written = plan.inserts.map((i) => i[column]).filter((v) => v !== null);
			expect(new Set(written).size).toBe(written.length);
			expect(written.filter((v) => held.has(v))).toEqual([]);
		}
	});
});

describe('backupFor', () => {
	it('records what each update replaces and which rows the run adds', () => {
		const { plan } = run();
		const backup = backupFor(plan, rows, new Date('2026-09-27T12:00:00Z'));

		expect(backup.maxIdBefore).toBe(16587);
		expect(backup.rowCountBefore).toBe(4);
		expect(backup.updates.find((u) => u.id === 16587)!.before).toEqual({
			title: '',
			aliases: [],
		});
		expect(backup.insertedAnidbIds.sort()).toEqual([18700, 18886, 19067, 19972]);
	});
});

describe('column limits', () => {
	it('cuts a title to 191 characters and drops a URL that would not fit', () => {
		expect(Array.from(clipTitle('あ'.repeat(200))).length).toBe(191);
		expect(fitUrl('https://x/' + 'a'.repeat(190))).toBe('');
		expect(fitUrl('https://media.kitsu.app/a.jpg')).toBe('https://media.kitsu.app/a.jpg');
	});
});
