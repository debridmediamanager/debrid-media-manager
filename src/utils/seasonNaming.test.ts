import type { ScrapeSearchResult } from '@/services/mediasearch';
import corpus from '@/test/fixtures/season-titles.json';
import ptt from 'parse-torrent-title';
import { describe, expect, it } from 'vitest';
import { filterSeasonEpisodes, filterSeasonPacks } from './cachedTroveStreams';
import {
	episodesNamedForSeason,
	namedEpisodes,
	namedSeasons,
	titleNamesNoEpisode,
	titleNamesSeason,
} from './seasonNaming';

type CorpusRow = { imdbId: string; show: string; season: number; title: string };
const rows = corpus as CorpusRow[];

const seasonsOf = (title: string) => [...namedSeasons(title)].sort((a, b) => a - b);

describe('namedSeasons', () => {
	it('reads the plain forms', () => {
		expect(seasonsOf('The.Wire.S03.1080p.BluRay.x264')).toEqual([3]);
		expect(seasonsOf('The.Wire.Season.3.Complete.1080p')).toEqual([3]);
		expect(seasonsOf('The Wire Season 3')).toEqual([3]);
	});

	it('reads an unpadded season number', () => {
		// `Sherlock.S2.1080i.Blu-Ray.ReMuX` is real, and a padded-only pattern
		// (which is what the filter box builds) misses it entirely.
		expect(seasonsOf('Sherlock.S2.1080i.Blu-Ray.ReMuX.AVC.DD.5.1-R2D2')).toEqual([2]);
	});

	it('reads a season after an underscore', () => {
		// `The Wire_S02`: there is no word boundary between `e` and `_`.
		expect(seasonsOf('The Wire_S02')).toEqual([2]);
		expect(seasonsOf('[Spanish-Bluray]Attack_on_Titan_Season_1')).toEqual([1]);
	});

	it('reads ranges', () => {
		expect(seasonsOf('The.Wire.S01-S05.COMPLETE.BluRay.REMUX.1080p')).toEqual([1, 2, 3, 4, 5]);
		expect(seasonsOf('Sherlock S1-3 BDRip 1080p [Lizard]')).toEqual([1, 2, 3]);
		expect(seasonsOf('The Wire (Season 1-5) (2002-2008)')).toEqual([1, 2, 3, 4, 5]);
		expect(seasonsOf('The Wire 2002 Complete Series Seasons 1 to 5 1080p')).toEqual([
			1, 2, 3, 4, 5,
		]);
		expect(seasonsOf('House MD All Seasons (1-8) 720p Ultra-Compressed')).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8,
		]);
	});

	it('reads comma and dot separated lists', () => {
		expect(seasonsOf('Breaking Bad Season 1, 2, 3, 4 & 5 + Extras')).toEqual([1, 2, 3, 4, 5]);
		expect(seasonsOf('The Wire Seasons 1.2.3.4.5 Complete Series.Fuji74')).toEqual([
			1, 2, 3, 4, 5,
		]);
		expect(seasonsOf('Adventure Time Season 1 2 3 4 5 6 7 8 9 10')).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
		]);
	});

	it('reads the season words real groups actually ship', () => {
		expect(seasonsOf('The Walking Dead Temporada 2 [BluRay 1080p]')).toEqual([2]);
		expect(seasonsOf('The Wire - saison 3 - MULTI')).toEqual([3]);
		expect(seasonsOf('Black Mirror - Чёрное зеркало. Сезон 3. NewStudio. 1080p')).toEqual([3]);
		expect(seasonsOf('GOT 4K SEASON 03')).toEqual([3]);
	});

	it('reads a number that leads the word', () => {
		expect(seasonsOf('Rick and Morty 2018 - 3ª Temporada Completa (1080p)')).toEqual([3]);
	});

	it('does not mistake resolution, codec or audio for a season', () => {
		// The dangerous direction: a spurious season would let a run put the
		// wrong thing in the library.
		expect(seasonsOf('Breaking Bad Season 2 1080p BluRay x264 DTS-HD MA 5.1')).toEqual([2]);
		expect(seasonsOf('The.Wire.Season.3.2160p.x265.10bit.DTS-HD.MA.5.1')).toEqual([3]);
	});

	it('says nothing rather than guessing when the title names no season', () => {
		expect(seasonsOf('The.Wire.1080p.BluRay.x264-GROUP')).toEqual([]);
	});
});

describe('namedEpisodes', () => {
	it('reads SxxEyy and NxM', () => {
		expect(episodesNamedForSeason('The.Wire.S03E04.1080p', 3)).toEqual([4]);
		expect(episodesNamedForSeason('The.Wire.3x04.1080p', 3)).toEqual([4]);
		expect(episodesNamedForSeason('The.Wire.S3E4.1080p', 3)).toEqual([4]);
	});

	it('reads an episode range and a multi-episode file', () => {
		expect(episodesNamedForSeason('The.Wire.S03E01-E03.1080p', 3)).toEqual([1, 2, 3]);
		expect(episodesNamedForSeason('The.Wire.S03E01E02.1080p', 3)).toEqual([1, 2]);
	});

	it('does not read an episode out of a language or feature tag', () => {
		// The measured failure: `ptt` calls each of these a single episode, so a
		// run would add a whole season pack believing it got one episode.
		expect(namedEpisodes('The.Wire.S02.720p.WEB-DL.2xRus.Eng.HDCLUB').size).toBe(0);
		expect(namedEpisodes('Breaking.Bad.S01.2160p.WEB-DL.5xRus.Ukr.Eng.TrollUHD').size).toBe(0);
		expect(namedEpisodes('Breaking.Bad.S01.1080p.3D.FULL-SBS.HEVC.SBS-SUB.ENG-HUN').size).toBe(
			0
		);
		expect(namedEpisodes('The Wire - Temporada 1 Completa [Cap. 101_113][DTS 2.0]').size).toBe(
			0
		);
	});

	it('does not read an episode out of a codec', () => {
		expect(namedEpisodes('The.Wire.S03.1080p.BluRay.x264-GROUP').size).toBe(0);
		expect(namedEpisodes('The.Wire.S03.2160p.x265.10bit').size).toBe(0);
	});

	it('does not continue an episode run across a bare separator', () => {
		// `S01E01 1080p` must not come back as episode 1080.
		expect(episodesNamedForSeason('The.Wire.S01E01 1080p.WEB', 1)).toEqual([1]);
	});

	it('reports nothing for a season pack, which is what a pack looks like', () => {
		expect(titleNamesNoEpisode('The.Wire.S03.1080p.BluRay.x264-GROUP')).toBe(true);
		expect(titleNamesNoEpisode('The.Wire.S03E04.1080p')).toBe(false);
	});
});

/**
 * The corpus is 3,815 unique release titles pulled from the live index on
 * 2026-09-12 - eighteen shows, three seasons each, chosen to include shows
 * whose own names carry numbers (`1923`, `The 100`) and non-English release
 * groups. It is the input these filters actually run against, so the
 * assertions below are about the whole of it rather than a handful of samples.
 */
describe('against the live corpus', () => {
	const asRow = (r: CorpusRow): ScrapeSearchResult => ({
		hash: `${r.imdbId}${r.season}${r.title}`.slice(0, 40).padEnd(40, '0'),
		title: r.title,
		fileSize: 5000,
	});

	it('offers no pack whose title does not name that season', () => {
		const offenders: string[] = [];
		for (const r of rows) {
			for (const pack of filterSeasonPacks([asRow(r)], { season: r.season })) {
				if (!titleNamesSeason(pack.title, r.season)) {
					offenders.push(`S${r.season} :: ${pack.title}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it('offers no episode whose title does not name that season and episode', () => {
		const offenders: string[] = [];
		for (const r of rows) {
			const buckets = filterSeasonEpisodes([asRow(r)], { season: r.season });
			for (const [episode, bucket] of buckets) {
				for (const candidate of bucket) {
					if (!episodesNamedForSeason(candidate.title, r.season).includes(episode)) {
						offenders.push(`S${r.season}E${episode} :: ${candidate.title}`);
					}
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it('never offers the same release as both a pack and an episode', () => {
		const both: string[] = [];
		for (const r of rows) {
			const row = asRow(r);
			const isPack = filterSeasonPacks([row], { season: r.season }).length > 0;
			const isEpisode = filterSeasonEpisodes([row], { season: r.season }).size > 0;
			if (isPack && isEpisode) both.push(`S${r.season} :: ${r.title}`);
		}
		expect(both).toEqual([]);
	});

	it('keeps the season packs whose names carry a phantom episode number', () => {
		// `ptt` reads an episode out of `2xRus`, `3D` and `Cap. 101`, which both
		// dropped these from the pack list and offered them as single episodes.
		// 88 distinct titles in this fixture are affected (131 rows before the
		// fixture was deduplicated), and every one of them is a real pack.
		const recovered = rows.filter((r) => {
			const parsed = ptt.parse(r.title) as { season?: number; episode?: number };
			const pttCalledItAnEpisode = typeof parsed.episode === 'number';
			if (!pttCalledItAnEpisode) return false;
			return filterSeasonPacks([asRow(r)], { season: r.season }).length > 0;
		});

		expect(recovered.length).toBeGreaterThanOrEqual(80);
		// And none of them is offered as an episode any more.
		for (const r of recovered) {
			expect(filterSeasonEpisodes([asRow(r)], { season: r.season }).size).toBe(0);
		}
	});
});
