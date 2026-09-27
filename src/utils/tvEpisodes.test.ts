import corpus from '@/test/fixtures/season-titles.json';
import corpusShows from '@/test/fixtures/seasonEpisodes/corpus-shows.json';
import {
	animeByImdbFixture,
	capturedTitles,
	mergedSeasonRows,
	showInfoFixture,
	usenetFixture,
	type SeasonFixtureId,
} from '@/test/utils/seasonFixtures';
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { filterSeasonEpisodes, filterSeasonPacks } from './cachedTroveStreams';
import {
	createTvEpisodeReader,
	firstUnairedEpisode,
	matchesTvEpisodeFilter,
	parseTvEpisode,
	parseTvEpisodeFilter,
	summarizeTvEpisodes,
	type TvEpisodeContext,
	type TvEpisodeMatch,
} from './tvEpisodes';

const seasonOf = (id: SeasonFixtureId) => Number(id.split('-s')[1]);

/** The context the page builds from `/api/info/show` and `/api/anime/by-imdb`. */
function contextFor(id: SeasonFixtureId): TvEpisodeContext {
	const info = showInfoFixture(id);
	return {
		season: seasonOf(id),
		episodeCounts: info.season_episode_counts,
		seasonCount: info.season_count,
		anime: Object.values(animeByImdbFixture(id).results).some((entries) => entries.length > 0),
	};
}

/** Every title the page holds once the Usenet section has been opened. */
const titlesOf = (id: SeasonFixtureId) => [
	...mergedSeasonRows(id).map((r) => r.title),
	...(usenetFixture(id) ?? []).map((r) => r.title),
];

const episodes = (...list: number[]): TvEpisodeMatch => ({ kind: 'episodes', episodes: list });
const range = (from: number, to: number) =>
	episodes(...Array.from({ length: to - from + 1 }, (_, i) => from + i));
const PACK: TvEpisodeMatch = { kind: 'pack' };
const OTHER: TvEpisodeMatch = { kind: 'other' };

// Every name below is one a source answered for that season on 2026-09-27;
// the test first checks it is in the captures, so none is made up.
const CASES: [SeasonFixtureId, string, TvEpisodeMatch][] = [
	// Spy x Family's third season is episodes 38-50 of the show.
	[
		'tt13706018-s3',
		'SPY.x.FAMILY.S03E46.Episode.46.1080p.CR.WEB-DL.JPN.AAC2.0.H.264.MSubs-ToonsHub.mkv',
		episodes(9),
	],
	[
		'tt13706018-s3',
		'Spy.x.Family.S03E05.Episode.42.The.Mommy-Friends.Scheme.1080p.AMZN.WEB-DL.JPN.DDP2.0.H.264.ESub-ToonsHub.mkv',
		episodes(5),
	],
	[
		'tt13706018-s3',
		"SPY x FAMILY_S03E39_Avoid Getting Tonitrus Bolts _ ■■■■'s Memories I.mp4",
		episodes(2),
	],
	['tt13706018-s3', '[SubsPlease] Spy x Family - 38 (480p) [6DD96862].mkv', episodes(1)],
	[
		'tt13706018-s3',
		'[MoezakuraSub]Spy x Family S3[49][WebRip][HEVC_DDP][CHS_JP&CHT_JP].mkv',
		episodes(12),
	],
	[
		'tt13706018-s3',
		'[Erai-raws] Spy x Family Season 3 - 05 [1080p CR WEB-DL AVC AAC][MultiSub][F3F2193A].mkv',
		episodes(5),
	],
	[
		'tt13706018-s3',
		'[NanakoRaws] Spy x Family S3 - 06 (WEB-DL 1920x1080 x264 AAC).mkv',
		episodes(6),
	],
	[
		'tt13706018-s3',
		'[Studio GreenTea] SPY×FAMILY Season 3 [01v2][WebRip][HEVC-10bit 1080p AAC].JPTC.mp4',
		episodes(1),
	],
	[
		'tt13706018-s3',
		'SPY x FAMILY S03E09 Anyas Era Has Come 1080p NF WEB-DL AAC2.0 H 264-VARYG (SPY×FAMILY Season 3, Multi-Subs)',
		episodes(9),
	],
	['tt13706018-s3', 'Spy x Family S3 [1080]', PACK],
	['tt13706018-s3', 'Spy x Family (Season 3) [1080p] [Amanogawa]', PACK],
	// `namedSeasons` reads `S01 - 24` as seasons 1 to 24; it is season 1's 24th.
	['tt13706018-s3', '[EMBER] Spy x Family S01 - 24.mkv', OTHER],
	[
		'tt13706018-s3',
		'[GJ.Y] Spy x Family Season 2 - 27 (CR 1920x1080 AVC AAC MKV) [32A38603].mkv',
		OTHER,
	],
	// Seven is season 1's seventh or season 3's own seventh: no way to tell.
	['tt13706018-s3', '[SubsPlease] Spy x Family - 07v2 (1080p) [E01DA6A8].mkv', OTHER],

	[
		'tt22248376-s1',
		'[Erai-raws] Sousou no Frieren - 05 [1080p][Multiple Subtitle][F2638BC1].mkv',
		episodes(5),
	],
	[
		'tt22248376-s1',
		"Frieren- Beyond Journey's End E5 Phantoms of the Dead 2160p B-Global WEB-DL x264 [Japanese] (AAC 2.0) MSubs_ToonsHub_.mkv",
		episodes(5),
	],
	[
		'tt22248376-s1',
		"Frieren Beyond Journey's End [EP01-12][WEB 1080p HEVC AAC][Multi Audio-MultiSub]",
		range(1, 12),
	],
	[
		'tt22248376-s1',
		"Frieren Beyond Journey's End [EP08v2] [Season 1] [WEB 1080p x265 HEVC AAC] [Multi Audio-MultiSubs]",
		episodes(8),
	],
	['tt22248376-s1', '[SubsPlease] Sousou no Frieren (01-28) (1080p) [Batch]', PACK],
	[
		'tt22248376-s1',
		'Frieren Beyond Journeys End S02 1080p BD Remux FLAC [JAP/ENG/SPA]- AF',
		OTHER,
	],

	[
		'tt0108778-s10',
		'Friends S10E17-E18 The Last One Part 1 and Part 2 2160p MAX WEB-DL DDP5 1 DV HDR H 265-FLUX',
		episodes(17, 18),
	],
	['tt0108778-s10', 'friends.s10e17e18.720p.bluray.sujaidr', episodes(17, 18)],
	['tt0108778-s10', 'FRIENDS.S10.E17-18.DVDr', episodes(17, 18)],
	['tt0108778-s10', 'Friends s10e1-8', range(1, 8)],
	['tt0108778-s10', 'Friends S10E01-17.1080p.WEBDL.DDP.2.0.ITA.ENG.G66', range(1, 17)],
	['tt0108778-s10', 'Friends.10x18.Dual.720p-lat', episodes(18)],
	['tt0108778-s10', 'Friends S10 Episode 17-18 (Bonus Episodes)', episodes(17, 18)],
	['tt0108778-s10', '[Xvid Ita-Eng] Friends S10 Ep 07-12 [TNT Village]', range(7, 12)],
	// All eighteen of eighteen is the season.
	['tt0108778-s10', '프렌즈 시즌10.Friends.S10E01-E20.완결.2003.1080p.한글자막', PACK],
	['tt0108778-s10', 'Friends S01-S10 COMPLETE 1080p BluRay Remux AVC AC3-WhaleHu', PACK],
	['tt0108778-s10', 'Friends - S06 - S10 - 1080p Bluray x265 HEVC AAC 5.1 Joy [UTR]', PACK],
	['tt0108778-s10', 'Friends.COMPLETE.FRENCH.BRRip.x264-CHiLL', PACK],
	['tt0108778-s10', 'FRIENDS: Season 10 - DVD 2 (Chapters 226 to 233)', PACK],
	['tt0108778-s10', 'Friends.sezon.10', PACK],
	// `全17集` is "all seventeen episodes", not episode 7.
	[
		'tt0108778-s10',
		'【高清剧集网发布 www.DDHDTV.com】老友记 第十季[HDR 杜比视界双版本][全17集][中文字幕].Friends.S10.2160p.MAX.WEB-DL.x265.DV.HDR.DDP5.1-ZeroTV',
		PACK,
	],
	['tt0108778-s10', 'Friends - S01 - S05 - 1080p Bluray x265 HEVC AAC 5.1 Joy [UTR]', OTHER],

	[
		'tt0386676-s4',
		'The.Office.US.S04E01E02.Fun.Run.1080p.BluRay.DDP.5.1.10bit.x265-ARTiCUN0.mkv',
		episodes(1, 2),
	],
	['tt0386676-s4', 'The_Office.4x11.Night_Out.HDTV_XviD-FoV', episodes(11)],
	['tt0386676-s4', 'The.Office.S04E01-19.ITA.WEBRIP.x264-NST', PACK],
	['tt0386676-s4', 'The.Office.US.S04D01.COMPLETE.BLURAY-SLIPSTREAM', PACK],
	[
		'tt0386676-s4',
		'[Bitsearch.to] The Office - Temporada 4 [HDTV 720p][Cap.401_404][AC3 5.1 Castellano][www.maxitorrent.com]',
		PACK,
	],
	// Another show filed under this season, past its nineteen episodes.
	['tt0386676-s4', 'The Simpsons S04E22 Krusty Gets Kancelled 1080p Web-DL x264-OFT', OTHER],

	['tt0121955-s29', 'South.Park.S29E01.1080p.WEB.h264-TRB', episodes(1)],
];

describe('parseTvEpisode over the season pages production served', () => {
	it.each(CASES)('%s: %s', (id, name, expected) => {
		expect(capturedTitles(id).has(name)).toBe(true);
		expect(parseTvEpisode(name, contextFor(id))).toEqual(expected);
	});

	it('reads the same names differently on a page that is not an anime show', () => {
		// Absolute numbering is an anime convention; a western page never reads it.
		const ctx = { ...contextFor('tt13706018-s3'), anime: false };
		expect(parseTvEpisode('[SubsPlease] Spy x Family - 38 (480p) [6DD96862].mkv', ctx)).toEqual(
			OTHER
		);
		expect(
			parseTvEpisode(
				'SPY.x.FAMILY.S03E46.Episode.46.1080p.CR.WEB-DL.JPN.AAC2.0.H.264.MSubs-ToonsHub.mkv',
				ctx
			)
		).toEqual(OTHER);
	});

	it('reads a bare episode on a one-season show and on no other', () => {
		const name =
			"Frieren- Beyond Journey's End E5 Phantoms of the Dead 2160p B-Global WEB-DL x264 [Japanese] (AAC 2.0) MSubs_ToonsHub_.mkv";
		const western = { season: 1, episodeCounts: { 1: 28 }, anime: false };
		expect(parseTvEpisode(name, { ...western, seasonCount: 1 })).toEqual(episodes(5));
		expect(parseTvEpisode(name, { ...western, seasonCount: 3 })).toEqual(OTHER);
	});
});

describe('summarizeTvEpisodes over whole result sets', () => {
	const ids: SeasonFixtureId[] = [
		'tt13706018-s3',
		'tt22248376-s1',
		'tt0121955-s29',
		'tt0108778-s10',
		'tt0386676-s4',
	];

	it.each(ids)('%s files every release once and every episode within the season', (id) => {
		const ctx = contextFor(id);
		const read = createTvEpisodeReader(ctx);
		const titles = titlesOf(id);
		const summary = summarizeTvEpisodes(titles, read);
		const count = ctx.episodeCounts[ctx.season];

		for (const episode of summary.episodes.keys()) {
			expect(episode).toBeGreaterThanOrEqual(1);
			expect(episode).toBeLessThanOrEqual(count);
		}
		// A range counts under each episode it covers, and nowhere else.
		const placed = titles.filter((t) => read(t).kind === 'episodes').length;
		expect(summary.packs + summary.other + placed).toBe(titles.length);
		for (const [episode, n] of summary.episodes) {
			expect(n).toBe(titles.filter((t) => matchesTvEpisodeFilter(read(t), episode)).length);
		}
	});

	it('finds every episode of both anime seasons', () => {
		for (const id of ['tt13706018-s3', 'tt22248376-s1'] as const) {
			const summary = summarizeTvEpisodes(
				titlesOf(id),
				createTvEpisodeReader(contextFor(id))
			);
			const count = contextFor(id).episodeCounts[seasonOf(id)];
			expect([...summary.episodes.keys()].sort((a, b) => a - b)).toEqual(
				Array.from({ length: count }, (_, i) => i + 1)
			);
		}
	});

	it("shows South Park's season 29 as one aired episode and five with nothing yet", () => {
		const summary = summarizeTvEpisodes(
			titlesOf('tt0121955-s29'),
			createTvEpisodeReader(contextFor('tt0121955-s29'))
		);
		expect([...summary.episodes]).toEqual([[1, 55]]);
		expect(summary.packs).toBe(0);
		expect(summary.other).toBe(0);
	});

	it("counts Friends' two-part finale under both of its episodes", () => {
		const id = 'tt0108778-s10';
		const read = createTvEpisodeReader(contextFor(id));
		const titles = titlesOf(id);
		const both = titles.filter((t) => {
			const m = read(t);
			return m.kind === 'episodes' && m.episodes.includes(17) && m.episodes.includes(18);
		});
		expect(both.length).toBeGreaterThanOrEqual(10);
		const summary = summarizeTvEpisodes(titles, read);
		expect(summary.episodes.get(17)).toBeGreaterThan(summary.episodes.get(16)!);
	});

	it('includes the Usenet rows in the counts once they are loaded', () => {
		const id = 'tt13706018-s3';
		const read = createTvEpisodeReader(contextFor(id));
		const torrents = summarizeTvEpisodes(
			mergedSeasonRows(id).map((r) => r.title),
			read
		);
		const all = summarizeTvEpisodes(titlesOf(id), read);
		const usenetOnly = summarizeTvEpisodes(
			usenetFixture(id)!.map((r) => r.title),
			read
		);
		expect(usenetOnly.episodes.get(13)).toBeGreaterThan(0);
		expect(all.episodes.get(13)).toBe(
			torrents.episodes.get(13)! + usenetOnly.episodes.get(13)!
		);
	});
});

describe('createTvEpisodeReader', () => {
	it('parses each name once', () => {
		const read = createTvEpisodeReader(contextFor('tt0108778-s10'));
		const first = read('Friends s10e1-8');
		expect(read('Friends s10e1-8')).toBe(first);
	});
});

/**
 * The corpus behind `seasonNaming`'s tests: 3,815 titles from eighteen shows,
 * three seasons each, read with each show's real episode counts. What the
 * season-pack route offers as a pack or files under an episode, the chips
 * must agree with, or the All Seasons run and the page disagree about a row.
 */
describe('against the season-pack corpus', () => {
	type Row = { imdbId: string; season: number; title: string };
	type Show = {
		season_count: number;
		season_episode_counts: Record<string, number>;
		animeByImdb: unknown[];
	};
	const shows = (corpusShows as { shows: Record<string, Show> }).shows;
	const ctxOf = (r: Row): TvEpisodeContext => ({
		season: r.season,
		episodeCounts: shows[r.imdbId].season_episode_counts,
		seasonCount: shows[r.imdbId].season_count,
		anime: shows[r.imdbId].animeByImdb.length > 0,
	});
	const asRow = (r: Row) => ({ hash: 'a'.repeat(40), title: r.title, fileSize: 5000 }) as never;

	it('reads every pack the season-pack route offers as a pack', () => {
		const offenders = (corpus as Row[])
			.filter((r) => filterSeasonPacks([asRow(r)], { season: r.season }).length > 0)
			.filter((r) => parseTvEpisode(r.title, ctxOf(r)).kind !== 'pack')
			.map((r) => `S${r.season} ${r.title}`);
		expect(offenders).toEqual([]);
	});

	it('files every episode the route files, within the season, under that episode', () => {
		const offenders: string[] = [];
		let fullSeasons = 0;
		for (const r of corpus as Row[]) {
			const count = ctxOf(r).episodeCounts[r.season] ?? 0;
			const filed = [...filterSeasonEpisodes([asRow(r)], { season: r.season }).keys()];
			const within = filed.filter((episode) => episode <= count);
			if (within.length === 0) continue;
			const match = parseTvEpisode(r.title, ctxOf(r));
			// `The.Bear.S01E01-08` on an eight-episode season is the season: the
			// route files it under all eight, the chips under Packs.
			if (match.kind === 'pack' && within.length === count) {
				fullSeasons++;
				continue;
			}
			for (const episode of within) {
				if (!matchesTvEpisodeFilter(match, episode)) {
					offenders.push(`S${r.season}E${episode} ${r.title}`);
				}
			}
		}
		expect(offenders).toEqual([]);
		expect(fullSeasons).toBe(7);
	});
});

describe('parseTvEpisodeFilter', () => {
	it.each([
		['5', 5],
		['18', 18],
		['packs', 'packs'],
		['other', 'other'],
	] as const)('reads %s', (raw, expected) => {
		expect(parseTvEpisodeFilter(raw)).toBe(expected);
	});

	it.each([undefined, '', '0', '-1', '5.5', 'batch', '99999', ['5']])('refuses %j', (raw) => {
		expect(parseTvEpisodeFilter(raw)).toBeNull();
	});
});

describe('firstUnairedEpisode', () => {
	const info = (imdbId: string) =>
		JSON.parse(
			fs.readFileSync(
				path.join(__dirname, `../test/fixtures/seasonEpisodes/info-show-${imdbId}.json`),
				'utf8'
			)
		);

	it("marks South Park's season 29 from its second episode on", () => {
		const sp = info('tt0121955');
		expect(firstUnairedEpisode(29, sp.next_episode_to_air, sp.last_episode_to_air)).toBe(2);
	});

	it('marks the whole of a season that has not started', () => {
		const simpsons = info('tt0096697');
		expect(simpsons.next_episode_to_air).toMatchObject({
			season_number: 38,
			episode_number: 1,
		});
		expect(
			firstUnairedEpisode(38, simpsons.next_episode_to_air, simpsons.last_episode_to_air)
		).toBe(1);
		expect(
			firstUnairedEpisode(37, simpsons.next_episode_to_air, simpsons.last_episode_to_air)
		).toBeNull();
	});

	it('marks nothing on an ended show or one with no schedule', () => {
		const friends = info('tt0108778');
		expect(
			firstUnairedEpisode(10, friends.next_episode_to_air, friends.last_episode_to_air)
		).toBe(19);
		const frieren = info('tt22248376');
		expect(
			firstUnairedEpisode(1, frieren.next_episode_to_air, frieren.last_episode_to_air)
		).toBeNull();
	});
});
