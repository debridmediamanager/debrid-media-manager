import bakeOffCinemeta from '@/test/fixtures/metadata/cinemeta-tt1877368-great-british-bake-off.json';
import bakeOffMdblist from '@/test/fixtures/metadata/mdblist-tt1877368-great-british-bake-off.json';
import bakeOffOmdb from '@/test/fixtures/metadata/omdb-tt1877368-great-british-bake-off.json';
import bakeOffFind from '@/test/fixtures/metadata/tmdb-find-tt1877368-great-british-bake-off.json';
import bakeOffTmdb from '@/test/fixtures/metadata/tmdb-tv-34549-great-british-bake-off-appended.json';
import bakeOffSeason from '@/test/fixtures/metadata/tmdb-tv-34549-season-1-great-british-bake-off.json';
import bakeOffTraktSeasons from '@/test/fixtures/metadata/trakt-seasons-tt1877368-great-british-bake-off.json';
import bakeOffTvmaze from '@/test/fixtures/metadata/tvmaze-2950-great-british-bake-off.json';
import { mergeShowRecord } from '@/utils/metadataRecord';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const cache = vi.hoisted(() => ({
	getTmdbTvInfo: vi.fn(),
	getTmdbMovieInfo: vi.fn(),
	searchTmdbByImdb: vi.fn(),
	getCinemetaSeries: vi.fn(),
	getTraktSummary: vi.fn(),
	getTraktShowSeasons: vi.fn(),
	getTraktShowEpisode: vi.fn(),
	getTvmazeShow: vi.fn(),
	getTmdbPassthrough: vi.fn(),
}));
const mdblist = vi.hoisted(() => ({ getInfoByImdbId: vi.fn() }));
vi.mock('@/services/metadataCache', () => ({ getMetadataCache: () => cache }));
vi.mock('@/services/mdblistClient', () => ({ getMdblistClient: () => mdblist }));
vi.mock('@/utils/omdb', () => ({ getOmdbMetadata: vi.fn(async () => bakeOffOmdb) }));

import { getMetadataBundle, parseMetadataId } from '@/services/metadata';

const original = process.env.TMDB_KEY;

describe('getMetadataBundle', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.TMDB_KEY = 'k';
		cache.getTmdbTvInfo.mockResolvedValue(bakeOffTmdb);
		cache.searchTmdbByImdb.mockResolvedValue(bakeOffFind);
		cache.getCinemetaSeries.mockResolvedValue(bakeOffCinemeta);
		cache.getTraktSummary.mockResolvedValue(null);
		cache.getTraktShowSeasons.mockResolvedValue(bakeOffTraktSeasons);
		cache.getTraktShowEpisode.mockResolvedValue(null);
		cache.getTvmazeShow.mockResolvedValue(bakeOffTvmaze);
		cache.getTmdbPassthrough.mockResolvedValue(bakeOffSeason);
		mdblist.getInfoByImdbId.mockResolvedValue(bakeOffMdblist);
	});
	afterAll(() => {
		if (original === undefined) delete process.env.TMDB_KEY;
		else process.env.TMDB_KEY = original;
	});

	it('names a title by IMDb id or by TMDB id and kind, nothing else', () => {
		expect(parseMetadataId('imdb:tt1877368')).toEqual({ by: 'imdb', imdb: 'tt1877368' });
		expect(parseMetadataId('tmdb:tv:34549')).toEqual({ by: 'tmdb', kind: 'tv', tmdb: 34549 });
		for (const raw of [
			'tmdb:34549',
			'tvdb:184871',
			'imdb:1877368',
			'tt1877368',
			'tmdb:show:1',
		]) {
			expect(parseMetadataId(raw)).toBeNull();
		}
	});

	// The real answers each source gave for The Great British Bake Off (TMDB 34549,
	// recorded 2026-09-26 and, for TMDB, 2026-10-15): every one under `sources`, the
	// merge beside them, and a season's episode list when one is asked for.
	it("answers every source's own record for a TMDB show, its merge, and the season asked for", async () => {
		const bundle = await getMetadataBundle(parseMetadataId('tmdb:tv:34549')!, { season: 1 });

		expect(bundle!.ids).toEqual({ imdb: 'tt1877368', tmdb: 34549, tvdb: 184871 });
		expect(bundle!.type).toBe('show');
		expect(bundle!.sources).toMatchObject({
			tmdb: bakeOffTmdb,
			mdblist: bakeOffMdblist,
			cinemeta: bakeOffCinemeta,
			omdb: bakeOffOmdb,
			tvmaze: bakeOffTvmaze,
			traktSeasons: bakeOffTraktSeasons,
			tmdbFind: bakeOffFind,
			tmdbSeason: bakeOffSeason,
		});
		expect((bundle!.sources.tmdbSeason as any).episodes[0].name).toBe('Cake Week');
		expect(cache.getTmdbPassthrough).toHaveBeenCalledWith('tv/34549/season/1', {});
		expect(bundle!.merged).toEqual(
			mergeShowRecord('tt1877368', {
				mdblist: bakeOffMdblist,
				trakt: null,
				tmdb: bakeOffTmdb,
				cinemeta: bakeOffCinemeta,
				omdb: bakeOffOmdb,
				traktSeasons: bakeOffTraktSeasons,
				traktNext: null,
				traktLast: null,
				tvmaze: bakeOffTvmaze,
			} as any)
		);
	});

	it('reads the same title by its IMDb id, on the TMDB show the id names', async () => {
		const bundle = await getMetadataBundle(parseMetadataId('imdb:tt1877368')!);
		expect(bundle!.ids.tmdb).toBe(34549);
		expect(bundle!.sources.tmdb).toEqual(bakeOffTmdb);
		expect(bundle!.sources).not.toHaveProperty('tmdbSeason');
	});

	// An anime cour TMDB files as a show of its own often has no IMDb id: TMDB alone answers.
	it('answers TMDB alone for a show IMDb does not know', async () => {
		cache.getTmdbTvInfo.mockResolvedValue({ ...bakeOffTmdb, external_ids: { imdb_id: null } });
		const bundle = await getMetadataBundle(parseMetadataId('tmdb:tv:34549')!, { season: 1 });
		expect(bundle!.ids).toEqual({ tmdb: 34549 });
		expect(bundle!.merged).toBeNull();
		expect(Object.keys(bundle!.sources).sort()).toEqual(['tmdb', 'tmdbSeason']);
		expect(mdblist.getInfoByImdbId).not.toHaveBeenCalled();
	});

	// rex reads a season list per season at start-up: TMDB alone, no OMDb or mdblist call.
	it('asks TMDB alone with sources=tmdb, by either id', async () => {
		const byTmdb = await getMetadataBundle(parseMetadataId('tmdb:tv:34549')!, {
			season: 1,
			tmdbOnly: true,
		});
		expect(Object.keys(byTmdb!.sources).sort()).toEqual(['tmdb', 'tmdbSeason']);
		const byImdb = await getMetadataBundle(parseMetadataId('imdb:tt1877368')!, {
			tmdbOnly: true,
		});
		expect(byImdb!.ids).toEqual({ imdb: 'tt1877368', tmdb: 34549, tvdb: 184871 });
		expect(byImdb!.sources).toEqual({ tmdbFind: bakeOffFind, tmdb: bakeOffTmdb });
		expect(mdblist.getInfoByImdbId).not.toHaveBeenCalled();
		expect(cache.getTraktSummary).not.toHaveBeenCalled();
	});

	it('answers nothing for a TMDB id TMDB does not have', async () => {
		cache.getTmdbTvInfo.mockRejectedValue({ response: { status: 404 } });
		expect(await getMetadataBundle(parseMetadataId('tmdb:tv:999999999')!)).toBeNull();
	});
});
