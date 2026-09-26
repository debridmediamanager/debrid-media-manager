import spiritedCinemeta from '@/test/fixtures/metadata/cinemeta-tt0245429-spirited-away.json';
import duneCinemeta from '@/test/fixtures/metadata/cinemeta-tt1160419-dune.json';
import bakeOffCinemeta from '@/test/fixtures/metadata/cinemeta-tt1877368-great-british-bake-off.json';
import spiritedMdblist from '@/test/fixtures/metadata/mdblist-tt0245429-spirited-away.json';
import duneMdblist from '@/test/fixtures/metadata/mdblist-tt1160419-dune.json';
import bakeOffMdblist from '@/test/fixtures/metadata/mdblist-tt1877368-great-british-bake-off.json';
import spiritedOmdb from '@/test/fixtures/metadata/omdb-tt0245429-spirited-away.json';
import duneOmdb from '@/test/fixtures/metadata/omdb-tt1160419-dune.json';
import bakeOffOmdb from '@/test/fixtures/metadata/omdb-tt1877368-great-british-bake-off.json';
import episodeOmdb from '@/test/fixtures/metadata/omdb-tt21958588-bake-off-episode.json';
import sawMdblistSearch from '@/test/fixtures/metadata/search-mdblist-saw-iv-2007.json';
import duneOmdbT from '@/test/fixtures/metadata/search-omdb-t-dune-2021.json';
import bakeOffOmdbT from '@/test/fixtures/metadata/search-omdb-t-great-british-bake-off-2010.json';
import sawOmdbT from '@/test/fixtures/metadata/search-omdb-t-saw-iv-2007.json';
import spiritedOmdbT from '@/test/fixtures/metadata/search-omdb-t-spirited-away-2001.json';
import duneTmdbSearch from '@/test/fixtures/metadata/search-tmdb-dune-2021.json';
import bakeOffTmdbSearch from '@/test/fixtures/metadata/search-tmdb-great-british-bake-off-2010.json';
import sawTmdbSearch from '@/test/fixtures/metadata/search-tmdb-saw-iv-2007.json';
import spiritedTmdbSearch from '@/test/fixtures/metadata/search-tmdb-spirited-away-2001.json';
import duneTraktSearch from '@/test/fixtures/metadata/search-trakt-dune-2021.json';
import bakeOffTraktSearch from '@/test/fixtures/metadata/search-trakt-great-british-bake-off-2010.json';
import sawTraktSearch from '@/test/fixtures/metadata/search-trakt-saw-iv-2007.json';
import spiritedTraktSearch from '@/test/fixtures/metadata/search-trakt-spirited-away-2001.json';
import spiritedTmdb from '@/test/fixtures/metadata/tmdb-movie-129-spirited-away.json';
import duneTmdb from '@/test/fixtures/metadata/tmdb-movie-438631-dune.json';
import bakeOffTmdb from '@/test/fixtures/metadata/tmdb-tv-34549-great-british-bake-off.json';
import spiritedTrakt from '@/test/fixtures/metadata/trakt-movie-tt0245429-spirited-away.json';
import duneTrakt from '@/test/fixtures/metadata/trakt-movie-tt1160419-dune.json';
import bakeOffTvmaze from '@/test/fixtures/metadata/tvmaze-2950-great-british-bake-off.json';
import {
	episodeRecordFromOmdb,
	mergeMovieRecord,
	mergeShowRecord,
	type MetadataRecord,
} from '@/utils/metadataRecord';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/metadataCache', () => ({ getMetadataCache: vi.fn() }));
vi.mock('@/services/metadata', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/metadata')>()),
	getMetadata: vi.fn(),
}));

import { getMetadata } from '@/services/metadata';
import { normalizeTitle, pickResolution, resolveTitle } from '@/services/metadata/resolve';
import { getMetadataCache } from '@/services/metadataCache';

/** Every search's real answer, captured 2026-09-26, keyed the way the resolver asks. */
const searches: Record<string, { tmdb: any; trakt: any; omdb: any }> = {
	'saw iv': { tmdb: sawTmdbSearch, trakt: sawTraktSearch, omdb: sawOmdbT },
	dune: { tmdb: duneTmdbSearch, trakt: duneTraktSearch, omdb: duneOmdbT },
	'spirited away': { tmdb: spiritedTmdbSearch, trakt: spiritedTraktSearch, omdb: spiritedOmdbT },
	'the great british bake off': {
		tmdb: bakeOffTmdbSearch,
		trakt: bakeOffTraktSearch,
		omdb: bakeOffOmdbT,
	},
};

// TMDB id to IMDb id, as TMDB's external_ids answers for the ids in the searches.
const tmdbToImdb: Record<string, string> = {
	'movie:663': 'tt0890870',
	'movie:438631': 'tt1160419',
	'movie:841': 'tt0087182',
	'movie:697620': 'tt12451788',
	'movie:129': 'tt0245429',
	'tv:34549': 'tt1877368',
};

// Full records where every provider was captured; for the other candidates, the
// title and year their own Trakt search hit reported.
const fullRecords: Record<string, MetadataRecord | null> = {
	tt1160419: mergeMovieRecord('tt1160419', {
		tmdb: duneTmdb,
		trakt: duneTrakt,
		mdblist: duneMdblist,
		cinemeta: duneCinemeta,
		omdb: duneOmdb,
	}),
	tt0245429: mergeMovieRecord('tt0245429', {
		tmdb: spiritedTmdb,
		trakt: spiritedTrakt,
		mdblist: spiritedMdblist,
		cinemeta: spiritedCinemeta,
		omdb: spiritedOmdb,
	}),
	tt1877368: mergeShowRecord('tt1877368', {
		tmdb: bakeOffTmdb,
		mdblist: bakeOffMdblist,
		cinemeta: bakeOffCinemeta,
		omdb: bakeOffOmdb,
		tvmaze: bakeOffTvmaze,
	}),
	tt21958588: episodeRecordFromOmdb('tt21958588', episodeOmdb),
};

function recordFromSearchHit(imdbId: string): MetadataRecord | null {
	for (const hits of [sawTraktSearch, duneTraktSearch, spiritedTraktSearch, bakeOffTraktSearch]) {
		for (const hit of hits as any[]) {
			const media = hit.movie ?? hit.show;
			if (media?.ids?.imdb !== imdbId) continue;
			return mergeMovieRecord(imdbId, { trakt: { ...media, ids: media.ids } });
		}
	}
	if (imdbId === 'tt12451788')
		return mergeMovieRecord(imdbId, {
			tmdb: { id: 697620, title: 'Dune', release_date: '2020-01-01' },
		});
	return null;
}

beforeEach(() => {
	vi.clearAllMocks();
	process.env.TMDB_KEY = 'test';
	vi.mocked(getMetadataCache).mockReturnValue({
		searchTmdbTitles: vi.fn(
			async (_kind: string, q: string) => searches[q.toLowerCase()]?.tmdb ?? { results: [] }
		),
		searchTraktTitles: vi.fn(async (kind: string, q: string) =>
			(searches[q.toLowerCase()]?.trakt ?? []).filter((hit: any) => hit.type === kind)
		),
		getOmdbByTitle: vi.fn(async (q: string, type: string) => {
			const hit = searches[q.toLowerCase()]?.omdb;
			return hit && hit.Type === type ? hit : null;
		}),
		getTmdbExternalIds: vi.fn(async (id: number, kind: string) => ({
			imdb_id: tmdbToImdb[`${kind}:${id}`] ?? null,
		})),
	} as any);
	vi.mocked(getMetadata).mockImplementation(
		async (imdbId: string) => fullRecords[imdbId] ?? recordFromSearchHit(imdbId)
	);
});

describe('resolveTitle, on searches captured 2026-09-26', () => {
	// mdblist's first answer is Saw III, which the uploaders took as the match.
	it('resolves Saw IV (2007) to Saw IV, not mdblist’s first answer', async () => {
		expect((sawMdblistSearch as any).search[0].title).toBe('Saw III');
		const result = await resolveTitle({ title: 'Saw IV', year: 2007, type: 'movie' });
		expect(result.confidence).toBe('exact');
		expect(result.match).toEqual(
			expect.objectContaining({ imdbId: 'tt0890870', title: 'Saw IV', year: 2007 })
		);
	});

	// OMDb's exact-title lookup answers the 1984 film.
	it('resolves Dune (2021) past OMDb’s 1984 answer', async () => {
		expect((duneOmdbT as any).imdbID).toBe('tt0087182');
		const result = await resolveTitle({ title: 'Dune', year: 2021, type: 'movie' });
		expect(result).toEqual(
			expect.objectContaining({
				confidence: 'exact',
				match: expect.objectContaining({ imdbId: 'tt1160419' }),
			})
		);
	});

	it('will not pick between two Dunes without a year', async () => {
		const result = await resolveTitle({ title: 'Dune', type: 'movie' });
		expect(result.confidence).toBe('ambiguous');
		expect(result.match).toBeNull();
		expect(result.candidates.map((c) => c.imdbId)).toEqual(
			expect.arrayContaining(['tt1160419', 'tt0087182'])
		);
	});

	// OMDb dates it 2003, the US release; the release name says 2001.
	it('matches Spirited Away (2001) on its original year', async () => {
		expect((spiritedOmdbT as any).Year).toBe('2003');
		const result = await resolveTitle({ title: 'Spirited Away', year: 2001, type: 'movie' });
		expect(result).toEqual(
			expect.objectContaining({
				confidence: 'exact',
				match: expect.objectContaining({ imdbId: 'tt0245429' }),
			})
		);
	});

	// Trakt proposes tt21958588 first, which on IMDb is an episode.
	it('resolves Bake Off (2010) to the series, not the episode id Trakt proposes', async () => {
		expect((bakeOffTraktSearch as any)[0].show.ids.imdb).toBe('tt21958588');
		const result = await resolveTitle({
			title: 'The Great British Bake Off',
			year: 2010,
			type: 'show',
		});
		expect(result).toEqual(
			expect.objectContaining({
				confidence: 'exact',
				match: expect.objectContaining({ imdbId: 'tt1877368' }),
			})
		);
	});
});

describe('pickResolution', () => {
	const dune2021 = fullRecords.tt1160419!;

	it('matches an alias: IMDb’s retitle of Dune', () => {
		const result = pickResolution({ title: 'Dune: Part One', year: 2021 }, [
			{ record: dune2021, votes: 1 },
		]);
		expect(result.match?.imdbId).toBe('tt1160419');
	});

	it('accepts a year one off as "near", and refuses two off', () => {
		expect(
			pickResolution({ title: 'Dune', year: 2022 }, [{ record: dune2021, votes: 1 }])
				.confidence
		).toBe('near');
		expect(
			pickResolution({ title: 'Dune', year: 2023 }, [{ record: dune2021, votes: 1 }])
				.confidence
		).toBe('none');
	});

	it('refuses a title that is only similar', () => {
		expect(
			pickResolution({ title: 'Dune Drifter', year: 2021 }, [{ record: dune2021, votes: 3 }])
				.match
		).toBeNull();
	});
});

describe('normalizeTitle', () => {
	it.each([
		['Saw IV', 'saw 4'],
		['Saw 4', 'saw 4'],
		['The Thing', 'thing'],
		['Amélie', 'amelie'],
		['Fast & Furious', 'fast and furious'],
		["Schindler's List", 'schindlers list'],
		['Dune: Part One', 'dune part one'],
	])('%s → %s', (input, expected) => {
		expect(normalizeTitle(input)).toBe(expected);
	});
});
