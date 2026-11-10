import { buildFranchiseIndex } from '@/services/anime/animeFranchise';
import type { FribbAnimeEntry } from '@/services/anime/animeMapping';
import { getMetadataCache } from '@/services/metadataCache';
import type { OnePaceCatalogue } from '@/services/onePace';
import onePaceList from '@/services/onePaceCatalogue.json';
import {
	cachedSources,
	placeReleases,
	titled,
	type Identify,
	type PlacedRelease,
	type PlacementSources,
	type PlaceRequest,
} from '@/services/placement';
import onePaceFun from '@/test/fixtures/onepace/fun-releases-2026-11-09.json';
import accented from '@/test/fixtures/placement/accented-titles.json';
import pastCour from '@/test/fixtures/placement/anime-past-cour.json';
import answers from '@/test/fixtures/placement/answers.json';
import articleShows from '@/test/fixtures/placement/article-shows.json';
import betweenTitled from '@/test/fixtures/placement/between-titled-files.json';
import bracketed from '@/test/fixtures/placement/bracketed-titles.json';
import cjkSeasons from '@/test/fixtures/placement/cjk-season-titles.json';
import directorsCuts from '@/test/fixtures/placement/directors-cut-primes.json';
import betweenPairs from '@/test/fixtures/placement/episodes-between-aligned-pairs.json';
import fairyTail from '@/test/fixtures/placement/fairy-tail-ovas.json';
import filmNumbered from '@/test/fixtures/placement/film-numbered-specials.json';
import filmsBeforeShows from '@/test/fixtures/placement/films-before-shows.json';
import filmsByTitle from '@/test/fixtures/placement/films-by-title.json';
import filmsInShows from '@/test/fixtures/placement/films-in-show-releases.json';
import filmsOfEpisodes from '@/test/fixtures/placement/films-of-imdb-episodes.json';
import filmsTitledApart from '@/test/fixtures/placement/films-titled-apart.json';
import filmsOfSentEpisodeIds from '@/test/fixtures/placement/films-of-sent-episode-ids.json';
import filmsBeforeColons from '@/test/fixtures/placement/films-titled-before-a-colon.json';
import filmsTitledByShow from '@/test/fixtures/placement/films-titled-by-show.json';
import firefly from '@/test/fixtures/placement/firefly-1437.json';
import spelled from '@/test/fixtures/placement/identifier-titles-spelled.json';
import imdbSeries from '@/test/fixtures/placement/imdb-series.json';
import kitchenNightmares from '@/test/fixtures/placement/kitchen-nightmares-tvdb.json';
import lost from '@/test/fixtures/placement/lost-tvdb-order.json';
import namesakes from '@/test/fixtures/placement/miniseries-namesake-films.json';
import mythbusters from '@/test/fixtures/placement/mythbusters-year-titles.json';
import office from '@/test/fixtures/placement/office-tvdb-order.json';
import otherShows from '@/test/fixtures/placement/other-show-files.json';
import partTitlesSpoken from '@/test/fixtures/placement/part-titles-spoken.json';
import qiNumberedSpecials from '@/test/fixtures/placement/qi-numbered-specials.json';
import releaseTags from '@/test/fixtures/placement/release-tags.json';
import cases from '@/test/fixtures/placement/releases.json';
import revival from '@/test/fixtures/placement/revival-seasons.json';
import fun1022 from '@/test/fixtures/placement/rex-fun-2026-10-22.json';
import fun1023 from '@/test/fixtures/placement/rex-fun-2026-10-23.json';
import fun1024 from '@/test/fixtures/placement/rex-fun-2026-10-24.json';
import fun1025 from '@/test/fixtures/placement/rex-fun-2026-10-25.json';
import fun1101 from '@/test/fixtures/placement/rex-fun-2026-11-01.json';
import runTogether from '@/test/fixtures/placement/run-together-segments.json';
import saga from '@/test/fixtures/placement/saga-titles.json';
import seasonOvas from '@/test/fixtures/placement/season-ovas.json';
import seasonSubtitles from '@/test/fixtures/placement/season-subtitles.json';
import seasonZeroSpecials from '@/test/fixtures/placement/season-zero-specials.json';
import secondChanceTvdb from '@/test/fixtures/placement/second-chance-tvdb-name.json';
import segmentAbbreviations from '@/test/fixtures/placement/segment-abbreviations.json';
import segmentLetters from '@/test/fixtures/placement/segment-letters.json';
import segmentTitles from '@/test/fixtures/placement/segment-titles.json';
import serialPack from '@/test/fixtures/placement/serial-in-show-pack.json';
import showNamedTitles from '@/test/fixtures/placement/show-named-titles.json';
import showsByTitle from '@/test/fixtures/placement/shows-named-by-title.json';
import byRuntime from '@/test/fixtures/placement/shows-told-apart-by-runtime.json';
import siblingShows from '@/test/fixtures/placement/sibling-shows.json';
import specialsByTitle from '@/test/fixtures/placement/specials-by-title.json';
import spellingVariants from '@/test/fixtures/placement/spelling-variants.json';
import subtitledSpecials from '@/test/fixtures/placement/subtitled-specials.json';
import tagsBeforeTitles from '@/test/fixtures/placement/tags-before-titles.json';
import splitShowGenericTitles from '@/test/fixtures/placement/split-show-generic-titles.json';
import titleChecks from '@/test/fixtures/placement/title-checks.json';
import titleEpisodes from '@/test/fixtures/placement/title-episode-numbers.json';
import titleParts from '@/test/fixtures/placement/title-parts.json';
import liveFind from '@/test/fixtures/placement/tmdb-find-tt14986406.json';
import tvdbSegments from '@/test/fixtures/placement/tvdb-segments.json';
import wwe from '@/test/fixtures/placement/wwe-air-dates.json';
import { buildAnimeIndex, spelledAlike } from '@/utils/episodePlacement';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/metadataCache', () => ({ getMetadataCache: vi.fn() }));
vi.mock('@/utils/tmdbAuth', async (original) => ({
	...(await original<typeof import('@/utils/tmdbAuth')>()),
	getTmdbAuth: () => ({ headers: {}, apiKey: 'test' }),
}));

/**
 * Real releases (rex-fun's library on fun, 2026-10-16, and rex's hand-read anime cases) and
 * every answer placing them needed, recorded from production: TMDB through DMM's metadata
 * API, IMDb's episodes and the `Anime` titles from dmmdb, the Fribb dataset and manami's
 * synonyms. See src/test/fixtures/placement/README.md.
 */
const recorded = answers as any;
/** content-identifier's recorded answers for these names, as `PlacementSources.identifier` gives them. */
const answered = (r: any, names: string[]) =>
	new Map(names.flatMap((name) => (r.identifier?.[name] ? [[name, r.identifier[name]]] : [])));
const anime = buildAnimeIndex(
	buildFranchiseIndex(recorded.anime.fribb as FribbAnimeEntry[]),
	recorded.anime.titles
);
const sources: PlacementSources = {
	find: async (id) => recorded.find[id] ?? null,
	show: async (id) => recorded.show[id] ?? null,
	season: async (id, n) => recorded.season[`${id}/${n}`] ?? null,
	episodeGroups: async (id) => recorded.episodeGroups?.[id] ?? null,
	episodeGroup: async (id) => recorded.episodeGroup?.[id] ?? null,
	episodeShow: async (id) => recorded.episodeShow[id] ?? null,
	seasonEpisodes: async (show, n) =>
		new Map(
			Object.entries(recorded.seasonEpisodes[`${show}/${n}`] ?? {}).map(([e, t]) => [
				Number(e),
				t as string,
			])
		),
	anime: async () => anime,
	identifier: async (names) => answered(recorded, names),
	searchTv: async (query) => recorded.searchTv?.[query] ?? null,
	imdbSeries: async (id) => recorded.imdbSeries?.[id] ?? null,
};
const identify: Identify = async (list) => list.map(({ name }) => recorded.identify[name] ?? null);
const place = (requests: PlaceRequest[], deadline = Infinity, from = sources, ask = identify) =>
	placeReleases(requests, ask, from, deadline);

/** Sources answering what a fixture recorded, nothing else. */
const recordedSources = (r: any): PlacementSources => ({
	find: async (id) => r.find[id] ?? null,
	show: async (id) => r.show[id] ?? null,
	season: async (id, n) => r.season[`${id}/${n}`] ?? null,
	seasonTranslations: async (id, n) => r.seasonTranslations?.[`${id}/${n}`] ?? null,
	episodeGroups: async (id) => r.episodeGroups?.[id] ?? null,
	episodeGroup: async (id) => r.episodeGroup?.[id] ?? null,
	episodeShow: async (id) => r.episodeShow[id] ?? null,
	seasonEpisodes: async (show, n) =>
		new Map(
			Object.entries(r.seasonEpisodes[`${show}/${n}`] ?? {}).map(([e, t]) => [
				Number(e),
				t as string,
			])
		),
	anime: async () => anime,
	identifier: async (names) => answered(r, names),
	searchTv: async (query) => r.searchTv?.[query] ?? null,
	searchMovie: async (query, year) => r.searchMovie?.[`${query}|${year}`] ?? null,
	movieIds: async (id) => r.movieIds?.[id] ?? null,
	movieTitles: async (id) => r.movieTitles?.[id] ?? null,
	imdbSeries: async (id) => r.imdbSeries?.[id] ?? null,
	namesakeSeries: async (id) => r.namesakeSeries?.[id] ?? null,
	tvdbSeriesOf: async (id) =>
		r.tvdbSeriesOf?.[id]
			? (r.tvdbSeriesOf[id].data ?? []).map((row: any) => row.series.id)
			: null,
	tvdbEpisodes: async (id, order) =>
		r.tvdbEpisodes?.[order ? `${id}/${order}` : id]?.data.episodes ?? null,
	findTvdbEpisode: async (id) => r.findTvdbEpisode?.[id] ?? null,
	searchTvdb: async (query, year) => r.searchTvdb?.[`${query}|${year}`] ?? null,
});

describe('a daily show named by its air date', () => {
	// rex#12: WWE's weekly releases name the day they aired and no episode, and came back
	// unplaced, so rex filed every one at S1E1 as versions of one episode. TMDB numbers Raw
	// (4656) 2026-07-27 S34E30 and SmackDown (1549) 2026-08-14 S28E33, as Sonarr does.
	it('places each on the episode TMDB lists as aired that day', async () => {
		const { releases } = await place(
			wwe.requests as PlaceRequest[],
			Infinity,
			recordedSources(wwe.answers)
		);
		expect(
			releases.map((r) => [
				r.tmdbId,
				...r.files.flatMap((f) => [f.season, f.episode, f.tmdbEpisodeId, f.how]),
			])
		).toEqual([
			[4656, 34, 30, 7436669, 'airdate'], // 2026-07-27
			[4656, 34, 32, 7568084, 'airdate'], // 08-10
			[4656, 34, 33, 7568088, 'airdate'], // 08-17
			[4656, 34, 34, 7627958, 'airdate'], // 08-24
			[4656, 34, 35, 7627959, 'airdate'], // 08-31
			[4656, 34, 36, 7682237, 'airdate'], // 09-07
			[4656, 34, 37, 7682238, 'airdate'], // 09-14
			[4656, 34, 38, 7682239, 'airdate'], // 09-21
			[4656, 34, 39, 7682241, 'airdate'], // 09-28
			[4656, 34, 40, 7811068, 'airdate'], // 10-05, the issue's own release
			[4656, 34, 41, 7811072, 'airdate'], // 10-12
			[4656, 34, 42, 7825715, 'airdate'], // 10-19
			// named by its episode as well: its numbers place it, as before
			[4656, 34, 31, 7568066, 'tmdb'],
			[1549, 28, 33, 7547478, 'airdate'], // 2026-08-14
			[1549, 28, 34, 7627961, 'airdate'], // 08-21
			[1549, 28, 35, 7627963, 'airdate'], // 08-28
			[1549, 28, 36, 7682215, 'airdate'], // 09-04
			[1549, 28, 37, 7682216, 'airdate'], // 09-11
			[1549, 28, 38, 7682217, 'airdate'], // 09-18
			[1549, 28, 39, 7682218, 'airdate'], // 09-25
			[1549, 28, 40, 7811080, 'airdate'], // 10-02
			[1549, 28, 43, 7825727, 'airdate'], // 10-23
			[1549, 28, 34, 7627961, 'tmdb'],
		]);
	});
});

describe('a show TMDB lists apart from the TVDB series Plex files it under', () => {
	// zurg#285: TMDB's Kitchen Nightmares 2023 (235884, no TVDB id) numbers the revival from S1;
	// TVDB and Plex keep it as seasons 7-9 of the 2007 series (80552), where Voleo's is S8E3
	it("places the revival's files on TVDB's numbering, with the series' TVDB id", async () => {
		const { releases } = await place(
			[kitchenNightmares.request as PlaceRequest],
			Infinity,
			recordedSources(kitchenNightmares.answers)
		);
		expect(releases[0]).toMatchObject({ kind: 'tv', tmdbId: 235884, tvdbId: 80552 });
		expect(releases[0].files.map((f) => [f.season, f.episode, f.tmdbEpisodeId, f.how])).toEqual(
			[
				[8, 1, 5767857, 'tvdbSeries'],
				[8, 3, 5896393, 'tvdbSeries'],
			]
		);
	});

	it("keeps TMDB's numbering where TVDB cannot be asked", async () => {
		const { tvdbEpisodes: _, ...withoutTvdb } = recordedSources(kitchenNightmares.answers);
		const { releases } = await place(
			[kitchenNightmares.request as PlaceRequest],
			Infinity,
			withoutTvdb
		);
		expect(releases[0].tvdbId).toBeUndefined();
		expect(releases[0].files.map((f) => [f.season, f.episode])).toEqual([
			[2, 1],
			[2, 3],
		]);
	});
});

describe('a season TVDB lists otherwise than TMDB (Lost, 2026-11-01)', () => {
	// TMDB's Lost S4 has 13 episodes, its E13 "There's No Place Like Home (2)" 85 minutes; TVDB's
	// has 14, E13 and E14 its two halves, as release groups number them: ROVERS' `S04E14` came back
	// unplaced, so rex had no file for the finale's second half
	const recorded = recordedSources(lost.answers);
	const { tvdbEpisodes: _, ...withoutTvdb } = recorded;
	const placed = async (request: object, parts: boolean, from = recorded) =>
		(
			await place(
				[{ ...(request as PlaceRequest), ...(parts ? { parts: true } : {}) }],
				Infinity,
				from
			)
		).releases[0];
	const files = (release: PlacedRelease) =>
		release.files.map((f) => [f.season, f.episode, f.tmdbEpisodeId, f.how, f.part ?? null]);

	it("places TVDB's S04E14 as the second part of TMDB's S4E13 for a caller that reads parts", async () => {
		expect(files(await placed(lost.requests.rovers, true))).toEqual([
			[4, 11, 333999, 'tmdb', null],
			[4, 12, 334004, 'tmdb', null],
			[4, 13, 334007, 'tmdb', 1],
			[4, 13, 334007, 'aligned', 2],
		]);
	});

	it('answers a caller that does not read parts as before: the second part unplaced', async () => {
		const answer = await placed(lost.requests.rovers, false);
		expect(answer).toEqual(await placed(lost.requests.rovers, false, withoutTvdb));
		expect(files(answer)).toEqual([
			[4, 11, 333999, 'tmdb', null],
			[4, 12, 334004, 'tmdb', null],
			[4, 13, 334007, 'tmdb', null],
			[null, null, null, null, null],
		]);
		expect(answer.files.some((f) => 'part' in f)).toBe(false);
	});

	// TVDB's aired order lists S1 as TMDB does, "Exodus (2)" one 85-minute E24; its DVD order, which
	// HiQVE's BluRay numbers by, has E24 and E25 "Exodus (2)" and "(3)"
	it('reads a season a release numbers past both lists in TVDB DVD order', async () => {
		expect(files(await placed(lost.requests.hiqve, true))).toEqual([
			[1, 23, 333944, 'tmdb', null],
			[1, 24, 333947, 'tmdb', 1],
			[1, 24, 333947, 'aligned', 2],
		]);
		expect(files(await placed(lost.requests.hiqve, false))[2]).toEqual([
			null,
			null,
			null,
			null,
			null,
		]);
	});

	// the Discord user's workaround: `Lost.S01E25` renamed `Lost.S01E24.Part.2`
	it('places a part a file names beside the one file of that episode named none', async () => {
		expect(files(await placed(lost.requests.renamed, true))).toEqual([
			[1, 23, 333944, 'tmdb', null],
			[1, 24, 333947, 'tmdb', 1],
			[1, 24, 333947, 'tmdb', 2],
		]);
	});

	// rex-fun's own Lost releases, numbered where TVDB and TMDB agree or as one multi-episode file
	it.each(['s03', 's04', 's05', 's06'] as const)(
		'answers %s as before, with parts or not',
		async (season) => {
			const before = await placed(lost.requests[season], false, withoutTvdb);
			expect(await placed(lost.requests[season], true)).toEqual(before);
			expect(await placed(lost.requests[season], false)).toEqual(before);
		}
	);
});

describe('a multi-episode file in a season TVDB lists otherwise than TMDB (The Office, 2026-11-09)', () => {
	// TMDB's S4E14 "Goodbye Toby" and S7E11 "Classy Christmas" are one episode each; TVDB, and
	// HiQVE's BluRay, number their halves S04E18E19 and S07E11E12. S04E18E19 came back unplaced
	// and S07E11E12 landed on TMDB's S7E11-E12, taking "Ultimatum" with it
	const recorded = recordedSources(office.answers);
	const placed = async (parts: boolean) =>
		(
			await place(
				[{ ...(office.requests.hiqve as PlaceRequest), ...(parts ? { parts: true } : {}) }],
				Infinity,
				recorded
			)
		).releases[0].files.map((f) => [f.season, f.episode, f.episodeEnd, f.tmdbEpisodeId, f.how]);

	it.each([true, false])(
		"places both halves on TMDB's one episode (parts: %s)",
		async (parts) => {
			expect(await placed(parts)).toEqual([
				[4, 13, null, 170236, 'aligned'],
				[4, 14, null, 170233, 'aligned'],
				[7, 10, null, 170274, 'tmdb'],
				[7, 11, null, 170285, 'aligned'],
				[7, 12, null, 170277, 'aligned'],
			]);
		}
	);
});

describe('a pack numbered in another order than TMDB, named by its titles', () => {
	// Firefly on the zen rig: DVD order, TMDB's aired order, three episodes TMDB files as specials
	it('places each file on the TMDB episode its title names', async () => {
		const { releases } = await place(
			[firefly.request as PlaceRequest],
			Infinity,
			recordedSources(firefly.answers)
		);
		expect(releases[0]).toMatchObject({ kind: 'tv', imdbId: 'tt0303461', tmdbId: 1437 });
		expect(releases[0].files.map((f) => [f.season, f.episode])).toEqual(firefly.byTitle);
		expect(releases[0].files.every((f) => f.how === 'tmdb')).toBe(true);
	});

	// The same files with their titles cut (`Firefly.S01E12.1080p.BRRip.AC3.x264-LESS.mkv`):
	// IMDb's own order, read through TMDB's find, scrambles E12-E14 onto S0E3, S0E1 and S0E2
	it("leaves files IMDb's order would scramble unplaced when no title can say which is which", async () => {
		const untitled = {
			...firefly.request,
			files: firefly.request.files.map(({ path, folder }) => ({
				path: path.replace(/(S01E\d\d)\.[\w.]+?(\.1080p)/, '$1$2'),
				folder,
			})),
		};
		expect(untitled.files[11].path).toBe('Firefly.S01E12.1080p.BRRip.AC3.x264-LESS.mkv');
		const { releases } = await place(
			[untitled as PlaceRequest],
			Infinity,
			recordedSources(firefly.answers)
		);
		const placed = releases[0].files.map((f) => [f.season, f.episode]);
		expect(placed.slice(0, 11)).toEqual(Array.from({ length: 11 }, (_, n) => [1, n + 1]));
		expect(placed.slice(11)).toEqual([
			[null, null],
			[null, null],
			[null, null],
		]);
	});
});

describe('placeReleases over real releases', () => {
	it.each(cases.map((c) => [c.request.files[0].path, c] as const))('%s', async (_, c) => {
		const { releases, complete } = await place([c.request as PlaceRequest]);
		expect(complete).toBe(true);
		expect(releases[0]).toEqual(c.expect);
	});

	const named = (name: string) => cases.find((c) => c.request.name.startsWith(name))!;

	// zurg reads exactly this as "skipped, ask again next pass" when `complete` is false, and
	// stores nothing for it
	const skippedShape = (request: PlaceRequest) => ({
		kind: null,
		imdbId: null,
		tmdbId: null,
		files: request.files.map(({ path }) => ({
			path,
			season: null,
			episode: null,
			episodeEnd: null,
			how: null,
			tmdbEpisodeId: null,
		})),
		skipped: true,
	});

	it('answers a release past the time budget in the shape zurg asks again for, files in order', async () => {
		const family = named('Family Guy').request as PlaceRequest;
		const foodWars = named('[Reza] Food Wars').request as PlaceRequest;
		const { releases, complete } = await place([family, foodWars], 0);
		expect(complete).toBe(false);
		expect(releases).toEqual([skippedShape(family), skippedShape(foodWars)]);
	});

	it('answers skipped when TMDB could not be asked', async () => {
		const family = named('Family Guy').request as PlaceRequest;
		const down = { ...sources, find: async () => null };
		expect(await place([family], Infinity, down)).toEqual({
			releases: [skippedShape(family)],
			complete: false,
		});
		const noShow = { ...sources, show: async () => null };
		expect((await place([family], Infinity, noShow)).releases[0]).toEqual(skippedShape(family));
	});

	it('answers a release whose id TMDB cannot use with the id sent, so it never reads as skipped', async () => {
		// zurg pushed tt10710138, which TMDB's find knows nothing by: IMDb's own list numbers it
		const abridged = named('[iKaos] TFS Dragon Ball Z Abridged');
		expect(recorded.find[abridged.request.imdbId!]).toEqual({
			movie_results: [],
			tv_results: [],
			tv_episode_results: [],
		});
		const { releases, complete } = await place([abridged.request as PlaceRequest]);
		expect(complete).toBe(true);
		expect(releases[0]).toMatchObject({ kind: 'tv', imdbId: 'tt10710138', tmdbId: null });
		expect(releases[0].skipped).toBeUndefined();
	});

	it('answers skipped when the identifier could not be asked about a name', async () => {
		const hibike = named('[Erai-raws] Hibike Euphonium 3').request as PlaceRequest;
		const { releases, complete } = await place(
			[{ ...hibike, imdbId: null }],
			Infinity,
			sources,
			async (list) => list.map(() => undefined)
		);
		expect(complete).toBe(false);
		expect(releases[0].skipped).toBe(true);
	});

	it('holds a fansub release back while the anime index cannot load, rather than place it on its own numbers', async () => {
		const hibike = named('[Erai-raws] Hibike Euphonium 3').request as PlaceRequest;
		const family = named('Family Guy').request as PlaceRequest;
		const { releases } = await place([hibike, family], Infinity, {
			...sources,
			anime: async () => null,
		});
		expect(releases[0].skipped).toBe(true);
		expect(releases[1]).toMatchObject({ kind: 'tv', files: [{ season: 11, episode: 16 }] });
	});

	it("names a show the anime index found by that show's own IMDb id, never the one sent", async () => {
		// zurg pushed tt2922300 (Monogatari Series: Second Season), a title TMDB's find knows nothing by
		const second = named('[smol] Monogatari Series Second Season');
		expect(second.request.imdbId).toBe('tt2922300');
		expect(second.expect).toMatchObject({ kind: 'tv', imdbId: 'tt1480925', tmdbId: 46195 });
	});

	it("takes a file its title did not place off an episode another file's title names", async () => {
		// TMDB's S6E16 is "The One with Unagi", the pack's S06E17
		const friends = named('Friends.S06');
		expect(friends.expect.files.map((f) => [f.season, f.episode])).toEqual([
			[null, null],
			[6, 16],
		]);
	});

	it('reads an episode id as its show and a film id on a release of seasons as a name to identify', async () => {
		const ben10 = named('Ben 10 Omniverse');
		expect(recorded.episodeShow[ben10.request.imdbId!]).toBe('tt2293002');
		expect(ben10.expect).toMatchObject({ imdbId: 'tt2293002', tmdbId: 46922 });
		// DMM's hash map files Star Wars: The Clone Wars S02 under the 2008 film
		const cloneWars = named('Star.Wars.The.Clone.Wars');
		expect(recorded.find[cloneWars.request.imdbId!].movie_results).toEqual([{ id: 12180 }]);
		expect(cloneWars.expect).toMatchObject({ kind: 'tv', imdbId: 'tt0458290', tmdbId: 4194 });
	});
});

/** A recorded case by the start of its release's name, sent with its IMDb id or without. */
const recordedCase = (name: string, withId = true) =>
	cases.find((c) => c.request.name.startsWith(name) && Boolean(c.request.imdbId) === withId)!;
const placedAt = (release: { files: { season: number | null; episode: number | null }[] }) =>
	release.files.map((f) => [f.season, f.episode]);

describe('a release whose IMDb id names a show TMDB no longer has', () => {
	// zurg pushed tt14986406 (IMDb's own title for Thousand-Year Blood War); DMM's cached find
	// names show 335660, which TMDB answers with a 404
	const tybw = [
		['[Lazier] Bleach Thousand-Year Blood War - 27', [2, 27]],
		['Bleach.Thousand-Year.Blood.War.S17E45', [2, 45]],
		['BLEACH.Thousand-Year.Blood.War.S04E01', [2, 41]],
		['[ToonsHub] Bleach - Thousand-Year Blood War - S17E20', [2, 20]],
		['[Feibanyama] Bleach Thousand Year Blood War S01E47', [2, 47]],
	] as const;

	it("is placed on Bleach's season 2 by its name, never answered skipped", async () => {
		expect(recorded.find.tt14986406.tv_results).toEqual([{ id: 335660 }]);
		expect(recorded.show['335660'].status_code).toBe(34);
		for (const [name, at] of tybw) {
			const { releases, complete } = await place([
				recordedCase(name).request as PlaceRequest,
			]);
			expect(complete).toBe(true);
			expect(releases[0]).toMatchObject({ kind: 'tv', imdbId: 'tt0434665', tmdbId: 30984 });
			expect(placedAt(releases[0])).toEqual([at]);
		}
	});

	it("is placed the same when TMDB's find names its one-episode stub instead", async () => {
		// TMDB's own find today: `Bleach: Sennen Kessen-hen`, one season holding an E13 alone
		expect(liveFind.tt14986406.tv_results).toEqual([{ id: 336301 }]);
		expect(recorded.show['336301'].seasons).toEqual([
			{ season_number: 1, episode_count: 1, air_date: null },
		]);
		const live = {
			...sources,
			find: async (id: string) => (liveFind as any)[id] ?? recorded.find[id] ?? null,
		};
		for (const [name, at] of tybw) {
			const request = recordedCase(name).request as PlaceRequest;
			const { releases } = await place([request], Infinity, live);
			expect(releases[0]).toMatchObject({ kind: 'tv', tmdbId: 30984 });
			expect(placedAt(releases[0])).toEqual([at]);
		}
	});

	it("reads a part's season as its cour: TYBW's S04E01 is the Calamity's first", async () => {
		const mythicore = recordedCase('BLEACH.Thousand-Year.Blood.War.S04E01');
		const { releases } = await place([mythicore.request as PlaceRequest]);
		expect(releases[0].files[0]).toMatchObject({ season: 2, episode: 41, how: 'anime' });
		// TMDB's S2E41 is "GOD OF THUNDER", which VARYG's `S01E41.GOD.OF.THUNDER` names
		const s2 = recorded.season['30984/2'].episodes;
		expect(s2.find((e: any) => e.episode_number === 41).name).toBe('GOD OF THUNDER');
	});

	it("tells TMDB's 404 from a read that failed, which is asked again", async () => {
		const getTmdbTvInfo = vi.fn();
		vi.mocked(getMetadataCache).mockReturnValue({ getTmdbTvInfo } as any);
		getTmdbTvInfo.mockRejectedValueOnce(
			Object.assign(new Error('Request failed with status code 404'), {
				response: { status: 404, data: recorded.show['335660'] },
			})
		);
		expect(await cachedSources.show(335660)).toEqual(recorded.show['335660']);
		getTmdbTvInfo.mockRejectedValueOnce(new Error('timeout of 10000ms exceeded'));
		expect(await cachedSources.show(335660)).toBeNull();
	});

	// `anime` reads TMDB's keywords off the show record placement already asks for, in that one call
	it("asks for a show's record with its keywords", async () => {
		const getTmdbTvInfo = vi.fn().mockResolvedValue({});
		vi.mocked(getMetadataCache).mockReturnValue({ getTmdbTvInfo } as any);
		await cachedSources.show(30983);
		expect(getTmdbTvInfo).toHaveBeenCalledTimes(1);
		expect(getTmdbTvInfo.mock.calls[0][1].split(',')).toContain('keywords');
	});
});

describe('a scene release no IMDb id or identifier names', () => {
	it('is named by the anime index when its files are numbered episodes', async () => {
		const ep = recordedCase('Detective.Conan.EP1212', false);
		expect(recorded.identify[ep.request.name]).toBeNull();
		const { releases } = await place([ep.request as PlaceRequest]);
		expect(releases[0]).toMatchObject({ kind: 'tv', imdbId: 'tt0131179', tmdbId: 30983 });
		expect(releases[0].files[0]).toMatchObject({ season: 1, episode: 1212, how: 'absolute' });
	});

	it('is left to the identifier when nothing says it is anime', async () => {
		// Netflix's Korean Kingdom, which the identifier does not name; the anime index's
		// `Kingdom` would put it on the anime's season 2
		const kingdom = recordedCase('Kingdom.S02E06', false);
		expect(recorded.identify[kingdom.request.name]).toBeNull();
		const { releases, complete } = await place([kingdom.request as PlaceRequest]);
		expect(complete).toBe(true);
		expect(releases[0]).toMatchObject({ kind: null, imdbId: null, tmdbId: null });
		expect(placedAt(releases[0])).toEqual([[null, null]]);
	});
});

describe('a fansub cour TMDB knows only as a film', () => {
	it("is placed on the show's episodes the anime index numbers it as", async () => {
		// tt43383343 is TMDB's movie 1669841, `Bleach: Thousand-Year Blood War - The Calamity`
		expect(recorded.find.tt43383343).toEqual({
			movie_results: [{ id: 1669841 }],
			tv_results: [],
			tv_episode_results: [],
		});
		for (const [name, at] of [
			['[Onalrie].Bleach.Sennen.Kessen.Hen', [2, 48]],
			['[Sakurato].Bleach', [2, 47]],
		] as const) {
			const { releases } = await place([recordedCase(name).request as PlaceRequest]);
			expect(releases[0]).toMatchObject({ kind: 'tv', imdbId: 'tt0434665', tmdbId: 30984 });
			expect(placedAt(releases[0])).toEqual([at]);
		}
	});
});

describe('a batch whose title the parser cut short', () => {
	it("names `Motto To Love-Ru` by its whole title and keeps the batch's extras unplaced", async () => {
		const motto = recordedCase('[KH] Motto To Love-Ru');
		const { releases } = await place([motto.request as PlaceRequest]);
		expect(releases[0]).toMatchObject({ kind: 'tv', imdbId: 'tt1216222', tmdbId: 34742 });
		const byPath = new Map(releases[0].files.map((f) => [f.path, [f.season, f.episode]]));
		for (const extra of [
			'Menu - 01.mkv',
			'Menu - 06.mkv',
			'NCED - 01.mkv',
			'NCED - 02.mkv',
			'NCOP.mkv',
		]) {
			expect(byPath.get(extra)).toEqual([null, null]);
		}
		const episodes = releases[0].files.filter((f) => f.path.startsWith('[KH] Motto'));
		expect(episodes.map((f) => [f.season, f.episode])).toEqual(
			Array.from({ length: 12 }, (_, n) => [2, n + 1])
		);
	});
});

describe('a series of its own that TMDB files inside a show', () => {
	it("is never counted through the show's seasons when the anime index does not know it", async () => {
		// TMDB files Aim to be a Pokémon Master as Pokémon's S25E47-E57; nothing maps it there
		const pm = recordedCase('[Some-Stuffs] Pocket Monsters - Aim to be a Pokémon Master 10');
		const s25 = recorded.show['60572'].seasons.find((s: any) => s.season_number === 25);
		expect(s25.episode_count).toBe(57);
		const { releases } = await place([pm.request as PlaceRequest]);
		expect(releases[0]).toMatchObject({ kind: 'tv', tmdbId: 60572 });
		expect(placedAt(releases[0])).toEqual([[null, null]]);
	});
});

describe('a file named with its season, its episode and the show running number', () => {
	it('is left unplaced where TMDB counts the episode its season and episode lead to otherwise', async () => {
		// `S11E01 - 286` is the French dub's numbering; IMDb's S11E01 is TMDB's S1E271
		const vf = recordedCase('Détective.Conan.-.Inédits.VF');
		expect(recorded.seasonEpisodes['tt0131179/11']['1']).toBe('tt1015287');
		expect(recorded.find.tt1015287.tv_episode_results).toEqual([
			{ show_id: 30983, season_number: 1, episode_number: 271 },
		]);
		const { releases } = await place([vf.request as PlaceRequest]);
		expect(releases[0]).toMatchObject({ kind: 'tv', tmdbId: 30983 });
		expect(placedAt(releases[0])).toEqual([
			[null, null],
			[null, null],
			[null, null],
		]);
	});
});

describe('which title a release is, when the id sent places nothing or no id is sent', () => {
	// rex-fun's unmatched releases (2026-10-22) and every answer placing them needed, content-identifier's
	// own included: the ids came from DMM's hash map, which zurg fills from Plex's matcher
	const checks = titleChecks as any;
	const from = recordedSources(checks.answers);
	const ask: Identify = async (list) =>
		list.map(({ name }) => checks.answers.identify[name] ?? null);
	const check = (name: string) => checks.cases.find((c: any) => c.request.name.startsWith(name));
	const placeCase = async (name: string) =>
		(await place([check(name).request as PlaceRequest], Infinity, from, ask)).releases[0];

	it.each([
		// the id sent, and the show the identifier is sure of, where all the files place
		['The.Magicians.S03', 'tt7326322', 64432],
		['The.100.S04', 'tt6464966', 48866],
		['Love death robots - season 3', 'tt14586350', 86831],
	])(
		'drops the id sent for %s when its show holds none of the files',
		async (name, sent, show) => {
			expect(check(name).request.imdbId).toBe(sent);
			const placed = await placeCase(name);
			expect(placed).toEqual(check(name).expect);
			expect(placed.tmdbId).toBe(show);
			expect(placed.files.every((f: any) => f.season !== null)).toBe(true);
		}
	);

	it.each([
		// filed as Chihayafuru; its files read Dragon Ball Z Abridged, which TMDB's find does not know
		['Season 3', 'tt10710138'],
		// filed as Power Rangers HyperForce; Dino Charge numbers itself as the franchise's season 22
		['Power Rangers Dino Charge', 'tt3521854'],
	])(
		'names %s as the title the identifier is sure of, unplaced, when TMDB cannot number it',
		async (name, imdbId) => {
			const placed = await placeCase(name);
			expect(placed).toEqual(check(name).expect);
			expect(placed).toMatchObject({ kind: 'tv', imdbId, tmdbId: null });
		}
	);

	it.each([
		// unsure answers that spell the name's own title, whose show holds the files
		['ReZERO.-Starting.Life.in.Another.World-.S04E13', 65942],
		['Fairy.Tail.E180.', 46261],
		['JJBA - S06E05', 45790],
	])('names %s by the title it spells, checked by its files placing', async (name, show) => {
		const placed = await placeCase(name);
		expect(placed).toEqual(check(name).expect);
		expect(placed.tmdbId).toBe(show);
		expect(placed.files[0].season).not.toBeNull();
	});

	it('names an unnumbered release as the one film it spells', async () => {
		const placed = await placeCase('BOCCHI THE ROCK! Recap Part 2');
		expect(placed).toMatchObject({ kind: 'movie', imdbId: 'tt32576588', tmdbId: 1201387 });
	});

	it.each([
		// the release names its show; its file `The Avengers (EMH)` reads as the 1961 Avengers
		['Marvels THE AVENGERS', 33623],
		// sequels TMDB files under their show
		['[ARC] Mushishi Zoku Shou', 26867],
		['[smol] Monogatari Series Second Season', 46195],
	])('keeps the show of %s', async (name, show) => {
		const placed = await placeCase(name);
		expect(placed).toEqual(check(name).expect);
		expect(placed.tmdbId).toBe(show);
	});
});

describe('packs on fun numbered otherwise than TMDB (2026-10-22)', () => {
	// zurg's own requests for releases rex-fun showed unmatched, and the answers placing them
	// needed, anime dataset entries included (see the fixtures README)
	const from: PlacementSources = {
		...recordedSources(fun1022.answers),
		anime: async () =>
			buildAnimeIndex(
				buildFranchiseIndex(fun1022.answers.anime.fribb as FribbAnimeEntry[]),
				fun1022.answers.anime.titles
			),
	};
	const placedHere = async (name: string) => {
		const c = fun1022.cases.find((c) => c.request.name.startsWith(name))!;
		return (await place([c.request as PlaceRequest], Infinity, from)).releases[0];
	};

	it.each(fun1022.cases.map((c) => [c.request.name, c] as const))('%s', async (_, c) => {
		const { releases, complete } = await place([c.request as PlaceRequest], Infinity, from);
		expect(complete).toBe(true);
		expect(releases[0]).toEqual(c.expect);
	});

	it("reads a fansub's version tag as no part of the title", async () => {
		// `[CyC] Mushishi v2.1`'s `Mushishi 01v2`: the anime index knows `Mushishi`, not
		// `Mushishi v2 1`, and TMDB's season 1 has the 26 episodes; its two DVD specials stay
		const release = await placedHere('[CyC] Mushishi');
		expect(placedAt(release)).toEqual(
			release.files.map((f) => {
				const at = /Mushishi (\d{2})v/.exec(f.path);
				return at ? [1, Number(at[1])] : [null, null];
			})
		);
	});

	it('cuts a scene word between the title and the tags', async () => {
		// the Frys pack numbers SpongeBob's segments on from TMDB's: `S10E24.Kenny.the.Cat.REPACK.1080p`
		// is TMDB's S9E15 "Kenny the Cat", which "kenny the cat repack" named nowhere
		const release = await placedHere('SpongeBob.SquarePants.1999.S10');
		const at = (title: string) =>
			placedAt(release)[release.files.findIndex((f) => f.path.includes(title))];
		expect(at('.Kenny.the.Cat.')).toEqual([9, 15]);
		expect(at('.Squid.Baby.')).toEqual([8, 46]);
	});

	it("places a file whose number after its episode is TMDB's title, not the show's count", async () => {
		const avengers = await placedHere('Marvels THE AVENGERS');
		const at = (release: Awaited<ReturnType<typeof placedHere>>, title: string) =>
			placedAt(release)[release.files.findIndex((f) => f.path.includes(title))];
		expect(at(avengers, 'S01 E15 - 459')).toEqual([1, 15]);
		expect(at(await placedHere('Family Guy - Seasons'), 'S07E12 - 420')).toEqual([7, 12]);
	});

	it('matches a title without its leading article and with its part spelled either way', async () => {
		const at = async (name: string, title: string) => {
			const release = await placedHere(name);
			return placedAt(release)[release.files.findIndex((f) => f.path.includes(title))];
		};
		expect(await at('Ben 10 Omniverse', 'S02E01 - Showdown Part 1')).toEqual([3, 1]);
		expect(await at('Marvels THE AVENGERS', 'Breakout, Part 2 of 2')).toEqual([1, 2]);
		expect(await at('QI', 'VG (Part 2)')).toEqual([10, 16]);
		expect(await at('Teenage Mutant Ninja Turtles', 'Tale of Master Yoshi')).toEqual([4, 19]);
	});

	it("numbers an English dub's seasons by TMDB's Dub Order", async () => {
		// TMDB's Dub Order for Medabots: the dub's season 2 is TMDB's season 1 out of order, its
		// season 3 TMDB's season 2 (Damashii), where S02E01 had been placed on Damashii's first
		const release = await placedHere('[Rillant] Medabots');
		const at = (code: string) =>
			placedAt(release)[release.files.findIndex((f) => f.path.includes(code))];
		expect([at('S01E06'), at('S02E01'), at('S03E01')]).toEqual([
			[1, 7],
			[1, 6],
			[2, 1],
		]);
	});

	it("reads a show's production code with its segment, the group's tag aside", async () => {
		// `The Amazing World of Gumball - 105a - The Pressure (720p.x264.ac3-5.1) [449]`: TMDB
		// lists the show by segment, S1E9 "The Pressure"; `[449]` had been read as the episode
		const release = await placedHere('The Amazing World of Gumball');
		const at = (code: string) =>
			placedAt(release)[release.files.findIndex((f) => f.path.includes(code))];
		expect([at('105a'), at('105b'), at('118b'), at('201a')]).toEqual([
			[1, 9],
			[1, 10],
			[1, 36],
			[2, 1],
		]);
	});
});

describe('a release whose titled files name another show than the one it was placed on', () => {
	// rex-fun's unmatched releases (2026-10-22) and every answer placing them needed, TMDB's TV
	// search and content-identifier's own answers included
	const sib = siblingShows as any;
	const from = recordedSources(sib.answers);
	const ask: Identify = async (list) =>
		list.map(({ name }) => sib.answers.identify[name] ?? null);
	const check = (name: string) => sib.cases.find((c: any) => c.request.name.startsWith(name));
	const placeCase = async (name: string) =>
		(await place([check(name).request as PlaceRequest], Infinity, from, ask)).releases[0];
	const at = (placed: any, path: string) => placed.files.find((f: any) => f.path.endsWith(path));

	it("moves Dino Charge's pack onto TMDB's Power Rangers, whose season 22 it is", async () => {
		// TMDB's find knows nothing by Dino Charge's IMDb id; Power Rangers titles S22E02 as the file does
		expect(sib.answers.find.tt3521854.tv_results).toEqual([]);
		const placed = await placeCase('Power Rangers Dino Charge');
		expect(placed).toEqual(check('Power Rangers Dino Charge').expect);
		expect(placed.tmdbId).toBe(2328);
		expect(
			at(placed, 'S22E02 - Past, Present and Fusion (480p x265 EDGE2020).mkv')
		).toMatchObject({
			season: 22,
			episode: 2,
		});
	});

	it("moves Batman TAS's seasons 2-3 onto The New Batman Adventures, which TMDB lists apart", async () => {
		const placed = await placeCase('Batman TAS Seasons 2-3');
		expect(placed).toEqual(check('Batman TAS Seasons 2-3').expect);
		// never the 1966 Batman its files spell (`Batman - 086 - Holiday Knights`): an unsure
		// answer overrides no id, and a show is taken here only by its episodes' titles
		expect(placed.tmdbId).toBe(4625);
		expect(at(placed, 'Batman - 086 - Holiday Knights   [DarkDream].mkv')).toMatchObject({
			season: 1,
			episode: 1,
		});
	});

	it('moves the 2003 Berenstain Bears off the 1985 show of the same name', async () => {
		const placed = await placeCase('Berenstain Bears (Cartoon');
		expect(placed).toEqual(check('Berenstain Bears (Cartoon').expect);
		expect(placed.tmdbId).toBe(4665);
		expect(at(placed, 'E54 (The Big Election).mp4')).toMatchObject({ season: 3, episode: 16 });
		// a title TMDB does not list is not counted onto another episode
		expect(at(placed, 'E53 (New Neighbors).mp4')).toMatchObject({
			season: null,
			episode: null,
		});
	});

	it.each([
		['[CyC] Mushishi v2.1', 26867],
		// TMDB's Monogatari, by Owarimonogatari's anime entry (smol's `S07E01` is its S4E1)
		['[smol] Owarimonogatari', 46195],
		['The Crocodile Hunter', 1904],
		// TMDB's search for Friends answers Among Friends and Thomas & Friends, no show of its name
		['Friends.1994', 1668],
	])('keeps %s on its show', async (name, show) => {
		const placed = await placeCase(name);
		// numbers only: the recorded anime index is older than the live one, which says `anime`
		// where this one says `absolute` for the same episodes
		const numbersOf = (r: any) => r.files.map((f: any) => [f.season, f.episode]);
		expect(numbersOf(placed)).toEqual(numbersOf(check(name).expect));
		expect(placed.tmdbId).toBe(show);
	});
});

describe("a series TMDB cannot use, numbered on IMDb's own list (zurg on fun, 2026-10-23)", () => {
	// TMDB has deleted Dragon Ball Z Abridged (tt10710138; tv/337297 answers status_code 34) and
	// its find knows neither it nor Digimon Adventure 02 (tt0243694); IMDb lists both by season
	// and episode, as Plex's agent does (plex://show/5d9c0885ef619b00204806bd, seasons 1-3 of
	// 12/22/33; Digimon Adventure 02 one season of 50)
	const from = {
		...recordedSources(imdbSeries.answers),
		anime: async () =>
			buildAnimeIndex(
				buildFranchiseIndex(imdbSeries.answers.anime.fribb as FribbAnimeEntry[]),
				imdbSeries.answers.anime.titles
			),
	};
	const placedHere = async (name: string, imdbId?: string) => {
		const c = imdbSeries.cases.find(
			(c) => c.request.name.startsWith(name) && (!imdbId || c.request.imdbId === imdbId)
		)!;
		return (await place([c.request as PlaceRequest], Infinity, from)).releases[0];
	};
	const at = (release: Awaited<ReturnType<typeof placedHere>>, part: string) => {
		const file = release.files.find((f) => f.path.includes(part))!;
		return [file.season, file.episode, file.how];
	};

	it.each(imdbSeries.cases.map((c) => [c.request.name, c] as const))('%s', async (_, c) => {
		const { releases, complete } = await place([c.request as PlaceRequest], Infinity, from);
		expect(complete).toBe(true);
		expect(releases[0]).toEqual(c.expect);
	});

	it("places a pack's files by their titles on IMDb's seasons, and by TFS's count through its parts", async () => {
		const pack = await placedHere('[iKaos] TFS Dragon Ball Z Abridged Collection');
		expect(pack).toMatchObject({ kind: 'tv', imdbId: 'tt10710138', tmdbId: null });
		expect(at(pack, '025 - Nail Is Piccolo')).toEqual([2, 15, 'imdb']);
		expect(at(pack, '055 - It')).toEqual([3, 25, 'imdb']);
		// IMDb spells its S2E1 `Loolike the Z-Warriors…`: TFS's count, which the titles agree with
		expect(at(pack, '011 - Looks Like The Z-Fighters')).toEqual([2, 1, 'imdb']);
		// a side series' number and a deleted scene's are no episodes of the show
		expect(at(pack, 'DragonShortZ - 001')).toEqual([null, null, null]);
		expect(at(pack, '001 - Deleted Scene Episode 3')).toEqual([null, null, null]);
		const series = await placedHere('TFS Dragon Ball Z Abridged - Complete');
		// TFS's `Episode 11` is IMDb's S2E1: IMDb lists its 10, 30 and 60 as Parts 1-3 each
		expect(at(series, 'Episode 9 -')).toEqual([1, 9, 'imdb']);
		expect(at(series, 'Episode 10 Part 3')).toEqual([1, 12, 'imdb']);
		expect(at(series, 'Episode 11 -')).toEqual([2, 1, 'imdb']);
		expect(at(series, 'Episode 30 Part 2')).toEqual([2, 21, 'imdb']);
		expect(at(series, 'Episode 31 -')).toEqual([3, 1, 'imdb']);
		expect(at(series, 'Episode 60 - Part 3')).toEqual([3, 32, 'imdb']);
		// beside its parts no part of it (IMDb's S3E33 "Die, Robot" by a title it does not carry),
		// nor a count of another series' (`Dragon Ball Top 24 Villains Part 1`), nor a film
		expect(at(series, 'Episode 60 - Epilogue')).toEqual([null, null, null]);
		expect(at(series, 'Top 24 Villains Part 1')).toEqual([null, null, null]);
		expect(at(series, 'Top 24 Movies and Specials 04-01')).toEqual([null, null, null]);
		expect(at(series, 'MOVIE Lord Slug')).toEqual([null, null, null]);
	});

	it("takes a file's name when the id sent is another show's episode", async () => {
		// `Season 3` came with tt2741248, an episode of Chihayafuru, and landed on its S3E1-E24
		const third = await placedHere('Season 3');
		expect(third).toMatchObject({ imdbId: 'tt10710138', tmdbId: null });
		expect(at(third, 'S03E25')).toEqual([3, 25, 'imdb']);
	});

	it("numbers a one-season series by its episodes' own numbers", async () => {
		// the identifier reads Digimon Adventure 02 as TMDB's Digimon: Digital Monsters, whose
		// season 1 is the 1999 series; `E03` had been placed there
		const digimon = await placedHere('Digimon.Adventure.02.E03');
		expect(digimon).toMatchObject({ imdbId: 'tt0243694', tmdbId: null });
		expect(at(digimon, 'e03.1080p.mkv')).toEqual([1, 3, 'imdb']);
	});

	it('keeps a show TMDB lists that the titles name as well', async () => {
		// Plex's agent knows Dino Charge only as Power Rangers' season 22, not by tt3521854
		expect(await placedHere('Power Rangers Dino Charge')).toMatchObject({ tmdbId: 2328 });
	});
});

describe("a placed file's TMDB episode id", () => {
	// Plex numbers Re:ZERO's TMDB S1E84 as its S4E18, so rex matches Plex's episode by the TMDB
	// episode id its rows carry (`tmdb://`), never by the index; TMDB's season lists carry the id
	it('is the id of the episode TMDB lists at the placed season and episode, on every rule', async () => {
		for (const c of cases) {
			const { releases } = await place([c.request as PlaceRequest]);
			for (const file of releases[0].files) {
				const listed = recorded.season[`${releases[0].tmdbId}/${file.season}`]?.episodes;
				const id = listed?.find((row: any) => row.episode_number === file.episode)?.id;
				expect(file.tmdbEpisodeId).toBe(file.episode === null ? null : (id ?? null));
			}
		}
	});

	it("is null on IMDb's numbering, which names no TMDB episode", async () => {
		const abridged = cases.find((c) =>
			c.request.name.startsWith('[iKaos] TFS Dragon Ball Z Abridged')
		)!;
		const { releases } = await place([abridged.request as PlaceRequest]);
		expect(releases[0].files.find((f) => f.path.includes('025 - Nail'))).toMatchObject({
			season: 2,
			episode: 15,
			how: 'imdb',
			tmdbEpisodeId: null,
		});
	});
});

describe('what rex-fun still could not match on 2026-10-23', () => {
	// zurg's requests for the releases behind rex-fun's unmatched episode rows after its morning
	// re-placement, and every answer placing them needed (see the fixtures README)
	const from: PlacementSources = {
		...recordedSources(fun1023.answers),
		anime: async () =>
			buildAnimeIndex(
				buildFranchiseIndex(fun1023.answers.anime.fribb as FribbAnimeEntry[]),
				fun1023.answers.anime.titles
			),
	};
	const ask: Identify = async (list) =>
		list.map(({ name }) => (fun1023.answers.identify as any)?.[name] ?? null);
	// the case of that release holding a file named so, where one release has several cases
	const placedHere = async (name: string, file = '') => {
		const c = fun1023.cases.find(
			(c) =>
				c.request.name.startsWith(name) &&
				c.request.files.some((f) => f.path.includes(file))
		)!;
		return (await place([c.request as PlaceRequest], Infinity, from, ask)).releases[0];
	};
	const at = (release: Awaited<ReturnType<typeof placedHere>>, part: string) => {
		const file = release.files.find((f) => f.path.includes(part))!;
		return [file.season, file.episode];
	};

	it.each(fun1023.cases.map((c) => [c.request.name, c] as const))('%s', async (_, c) => {
		const { releases, complete } = await place(
			[c.request as PlaceRequest],
			Infinity,
			from,
			ask
		);
		expect(complete).toBe(true);
		expect(releases[0]).toEqual(c.expect);
	});

	it("reads a word like `Special` or `Op` after an episode's number as its title", async () => {
		const pack = await placedHere('[Anime Time] One Piece (0001-1071+Movies+Specials)');
		expect(at(pack, '0700 - The Ultimate Power! The Secret of the Op-Op Fruit!')).toEqual([
			17, 700,
		]);
		expect(at(pack, '0918 - It')).toEqual([21, 918]);
	});
	it("places a special by its own title on TMDB's season 0", async () => {
		// `[KH] Teasing Master Takagi-san - OVA - Water Slide` is TMDB's S0E1 "Water Slide"
		expect(at(await placedHere('[KH] Teasing Master Takagi-san'), 'Water Slide')).toEqual([
			0, 1,
		]);
		const chicken = await placedHere('Robot Chicken (2005-2020)');
		expect(at(chicken, 'Robot Chicken Star Wars II.mkv')).toEqual([0, 7]);
		// TMDB's S0E4 is "Robot Chicken: Star Wars", no title the file has: no special
		expect(at(chicken, 'Robot Chicken Star Wars I.mkv')).toEqual([null, null]);
	});
	it('numbers a show by an episode group TMDB names after TheTVDB', async () => {
		// Detective Conan's "Aired Order (TheTVDB)": Crunchyroll's `S33E26` is TMDB's S1E1173
		const ghost = await placedHere('Detective.Conan.S33E26.a.Ghost');
		expect(ghost.files[0]).toMatchObject({ season: 1, episode: 1173, how: 'tvdb' });
	});
	it('moves a release to a show TMDB lists under its own title when that show holds more of it', async () => {
		// the id sent names the 11-episode Nodame Cantabile drama; the anime of that name has 23
		expect(await placedHere('[HEVC] Nodame Cantabile')).toMatchObject({ tmdbId: 45527 });
		// Bunny Girl Senpai's season 2 is named "Rascal Does Not Dream of Santa Claus"
		const rascal = await placedHere('[Delta] Rascal');
		expect(rascal).toMatchObject({ tmdbId: 82739 });
		expect(at(rascal, 'S02E13')).toEqual([2, 13]);
	});
	it("numbers a cour's files in the packer's own seasons by the cour the release names", async () => {
		// smol's `S07` is no season TVDB numbers the Monogatari series in: Owarimonogatari's own
		const owari = await placedHere('[smol] Owarimonogatari');
		expect(owari).toMatchObject({ tmdbId: 46195 });
		expect(at(owari, 'S07E01')).toEqual([4, 1]);
	});
	it('places a number TMDB titles an episode with', async () => {
		// TMDB titles Sesame Street's episodes with their production numbers
		const street = await placedHere('Sesame Street', 'Episode 3815');
		expect(at(street, "Episode 3815 - Oscar's trash sale - Part 1")).toEqual([30, 30]);
		// counted through the seasons it had landed on S11E95 "Episode 1410"
		expect(at(street, 'Episode 1364 - C-3PO')).toEqual([11, 49]);
		// no TMDB title carries 1969
		expect(at(street, 'Episode 1969')).toEqual([null, null]);
	});
	it("numbers a pack by the episode group its seasons match, not TMDB's aired seasons", async () => {
		// the Polish pack's seasons 7-10 are TMDB's "Digital Order": 13 each, where TMDB airs 26s and 10s
		const pack = await placedHere('Futurama HD PL');
		expect(at(pack, 'Futurama.s07e01.pl')).toEqual([6, 1]);
		expect(at(pack, 'Futurama.s08e11.pl')).toEqual([6, 24]);
		expect(at(pack, 'Futurama.s10e13.pl')).toEqual([7, 26]);
		expect(at(pack, 'Futurama.s01e01.pl')).toEqual([1, 1]);
	});
	it("names a film inside a show's release on its own", async () => {
		const academia = await placedHere('My Hero Academia S01-04P1+Movies');
		expect(
			academia.files.find((f) => f.path.includes('[Movie 02] Heroes Rising'))
		).toMatchObject({
			season: null,
			kind: 'movie',
			imdbId: 'tt11107074',
			tmdbId: 592350,
		});
		// a game played through, titled as no film, and three pilot films read as one
		const beavis = await placedHere('Beavis and Butt-head S08E09');
		expect(
			beavis.files.find((f) => f.path.includes('Virtual Stupidity'))!.kind
		).toBeUndefined();
		const bionic = await placedHere('The Six Million Dollar Man');
		expect(
			bionic.files.find((f) => f.path.includes('Wine, Women and War'))!.kind
		).toBeUndefined();
	});
	it("reads `Behind` after a scene episode token as the episode's title", async () => {
		// the identifier offers One Piece (1999) and (2023) alike; only the 1999 show holds E1154
		const ep = await placedHere('One.Piece.EP1154');
		expect(ep).toMatchObject({ tmdbId: 37854 });
		expect(ep.files[0]).toMatchObject({ season: 22, episode: 1154 });
	});
	it("titles a release's one file named by a hash as the release", async () => {
		// `SpongeBob.SquarePants.S10E24.Kenny.the.Cat.…` holds `060332c365c0452ca9c51192416150af.mkv`
		const kenny = await placedHere('SpongeBob.SquarePants.S10E24.Kenny.the.Cat');
		expect(kenny.files[0]).toMatchObject({ season: 9, episode: 15 });
	});
	it('numbers a release on the run of episodes TMDB names after it', async () => {
		// smol's `S04E01`-`E23` are TMDB's season 3 "Monogatari Series: Second Season", not its
		// season 4 (Owarimonogatari), where `E01`-`E12` had landed by number
		const second = await placedHere('[smol] Monogatari Series Second Season');
		expect(second.files.filter((f) => f.season === 3)).toHaveLength(23);
		expect(second.files.some((f) => f.season === 4)).toBe(false);
		// `S10E01`-`E06` are S0E42-E47 "Zoku Owarimonogatari: Koyomi Reverse (1)"-"(6)"
		const zoku = await placedHere('[smol] Zoku Owarimonogatari');
		expect(zoku.files.filter((f) => f.season === 0).map((f) => f.episode)).toEqual([
			42, 43, 44, 45, 46, 47,
		]);
	});
});

describe('what rex-fun still could not match on 2026-10-24', () => {
	// zurg's requests for the releases behind rex-fun's unmatched rows, built as zurg builds them
	// from its .zurgtorrent, and every answer placing them needed (see the fixtures README)
	const from: PlacementSources = {
		...recordedSources(fun1024.answers),
		anime: async () =>
			buildAnimeIndex(
				buildFranchiseIndex(fun1024.answers.anime.fribb as FribbAnimeEntry[]),
				fun1024.answers.anime.titles
			),
	};
	const ask: Identify = async (list) =>
		list.map(({ name }) => (fun1024.answers.identify as any)?.[name] ?? null);
	const placedHere = async (name: string) => {
		const c = fun1024.cases.find((c) => c.request.name.startsWith(name))!;
		return (await place([c.request as PlaceRequest], Infinity, from, ask)).releases[0];
	};
	const at = (release: Awaited<ReturnType<typeof placedHere>>, part: string) => {
		const file = release.files.find((f) => f.path.includes(part))!;
		return [file.season, file.episode];
	};

	it.each(fun1024.cases.map((c) => [c.request.name, c] as const))('%s', async (_, c) => {
		const { releases, complete } = await place(
			[c.request as PlaceRequest],
			Infinity,
			from,
			ask
		);
		expect(complete).toBe(true);
		expect(releases[0]).toEqual(c.expect);
	});

	it("places a special by TMDB's title with the show's name after it", async () => {
		// "The Making of the Series: The World at War" (2026-11-10)
		const placed = await placedHere('The World at War (1973)');
		expect(at(placed, 'S00E01 - The Making of the Series')).toEqual([0, 9]);
	});

	it('reads `&` as `and`, `vs` as `versus` and an article anywhere as none', async () => {
		// TMDB's S12E11 "Gary & Spot"
		expect(at(await placedHere('SpongeBob.SquarePants.S12'), 'S12E11.Gary.and.Spot')).toEqual([
			12, 11,
		]);
		// TMDB's S5E4 "Pups Save the Hum-Mover", S5E5 "Sea Patrol: Pups Save a Sunken Sloop"
		const five = await placedHere('Paw Patrol Season 5');
		expect(at(five, 'S05E04.Pups.Save.a.Hum-Mover')).toEqual([5, 4]);
		expect(at(five, 'S05E05.Sea.Patrol.Pups.Save.the.Sunken.Sloop')).toEqual([5, 5]);
		// TMDB's S1E8 "The Crab and the Urchin", S1E5 "Hulk Versus the World"
		expect(at(await placedHere('Octonauts'), 'S01E03 - Crab and Urchin')).toEqual([1, 8]);
		expect(at(await placedHere('Marvels THE AVENGERS'), 'S01 E02 - Hulk vs the World')).toEqual(
			[1, 5]
		);
	});
	it("reads a title past TMDB's years after it and a broadcast's `HD` tag", async () => {
		// TMDB's S0E5 "Hitler's Germany: The People's Community (1933–1939)"
		const war = await placedHere('The World at War (1973)');
		expect(at(war, "S00E02 - Hitler's Germany - The People's Community")).toEqual([0, 5]);
		expect(at(war, "S00E03 - Hitler's Germany - Total War")).toEqual([0, 6]);
		// TMDB's S1E23 "Pups and the Ghost Pirate", S1E30 "Pups Save Christmas"
		const one = await placedHere('PAW.Patrol.Season1');
		expect(at(one, '12. Pups and the Ghost Pirate.HD.rus.eng')).toEqual([1, 23]);
		expect(at(one, '16. Pups Save Christmas.HD.rus.eng')).toEqual([1, 30]);
	});
	it('keeps a numbered file of a season TMDB numbers on through the one before', async () => {
		// TMDB has no season 2: S2E1 is its S1E26 by title and by number alike, so the titles do not
		// say the pack is numbered otherwise, and S02E03, titled otherwise, keeps its number
		const frontier = await placedHere('Shangri-La.Frontier.S02');
		expect(at(frontier, 'S02E03.Accelerating.Meetings')).toEqual([1, 28]);
		expect(at(frontier, 'S02E08.The.Lion.Catches.a.Rabbit')).toEqual([1, 33]);
	});
	it('places a file its title missed between the episodes its neighbours were titled onto', async () => {
		// TMDB's S1E19 is "Hindering and Restoration"; S02E05 and S02E07 are its S1E18 and S1E20
		const paradise = await placedHere('Hells.Paradise.S02');
		expect(at(paradise, 'S02E06.Conflict.and.Growing.Together')).toEqual([1, 19]);
		// a file numbered by nothing, between no titled neighbours, stays off every episode
		const zenki = await placedHere('[DmonHiro] Kishin Douji Zenki');
		expect(at(zenki, 'Clean Opening I.mkv')).toEqual([null, null]);
	});
});

describe('single episodes rex-fun showed as shows of their own on 2026-10-25', () => {
	// zurg-usenet's requests for one-episode releases DMM left unnamed, a Discord report's file, and
	// every answer placing them needed (see the fixtures README)
	const from: PlacementSources = {
		...recordedSources(fun1025.answers),
		anime: async () =>
			buildAnimeIndex(
				buildFranchiseIndex(fun1025.answers.anime.fribb as FribbAnimeEntry[]),
				fun1025.answers.anime.titles
			),
	};
	const ask: Identify = async (list) =>
		list.map(({ name }) => (fun1025.answers.identify as any)?.[name] ?? null);
	const placedHere = async (name: string) => {
		const c = fun1025.cases.find((c) => c.request.name.startsWith(name))!;
		return (await place([c.request as PlaceRequest], Infinity, from, ask)).releases[0];
	};
	const at = async (name: string) => {
		const { tmdbId, files } = await placedHere(name);
		return [tmdbId, files[0].season, files[0].episode];
	};

	it.each(fun1025.cases.map((c) => [c.request.name, c] as const))('%s', async (_, c) => {
		const { releases, complete } = await place(
			[c.request as PlaceRequest],
			Infinity,
			from,
			ask
		);
		expect(complete).toBe(true);
		expect(releases[0]).toEqual(c.expect);
	});

	it('takes the one of two same-named shows whose episode the title names', async () => {
		// Animaniacs of 1993 (82) and of 2020 (107124) both have an S1E25; the 1993 one's is the title
		expect(await at('Animaniacs - S01E25 - Garage Sale of the Century')).toEqual([82, 1, 25]);
		// the 1993 OVA (60862) reaches S01E07 only by counting through its two seasons
		expect(await at('JoJos.Bizarre.Adventure.S01E07.Sorrowful.Successor')).toEqual([
			45790, 1, 7,
		]);
		// Fruits Basket of 2019 (85991); the 2001 series (36941) titles its S1E26 "Let's Go Home"
		expect(await at('Fruits Basket S01E08 See You When You Get Back')).toEqual([85991, 1, 8]);
		expect(await at('Fruits Basket S01E24 Let')).toEqual([85991, 1, 24]);
	});
	it('reads a title written as UTF-8 and read as Latin-1', async () => {
		// the file is `Fruits Basket S01E19 Iâ\u0080\u0099m So Sorry!.mkv`, TMDB's S1E19 "I'm So Sorry!"
		expect(await at('Fruits Basket S01E19 I')).toEqual([85991, 1, 19]);
	});
	it('takes a title TMDB spells as the name where IMDb spells it otherwise', async () => {
		// an alternative title of KONOSUBA - God's blessing on this wonderful world!
		expect(await at('KonoSuba.S02E01.German')).toEqual([65844, 2, 1]);
		// "Would I Lie to You? (AU)", which the identifier ranks below the British show (4775)
		expect(await at('Would.I.Lie.To.You.AU.S01E03')).toEqual([158741, 1, 3]);
		// IMDb's Karakai Jouzu no Takagi-san; the 2024 drama of TMDB's name (235913) has no S1E9
		expect(await at('Teasing.Master.Takagi-san.S01E09')).toEqual([75865, 1, 9]);
		expect(await at('Teasing.Master.Takagi-san.S02E01')).toEqual([75865, 2, 1]);
	});
	it('leaves a file two same-named shows hold alike, with no title naming one, unplaced', async () => {
		for (const name of [
			// the 2018 anime and the 2024 drama both have an S1E1
			'Teasing.Master.Takagi-san.S01E01',
			// no title, and both Fruits Baskets have an S1E6
			'Fruits.Basket.S01E06',
			// TMDB titles the 2012 series' S1E5 "The Dark Knights", the OVA's another way
			'JoJos.Bizarre.Adventure.S01E05.Black.Knights',
		]) {
			expect(await placedHere(name)).toMatchObject({
				kind: null,
				imdbId: null,
				tmdbId: null,
			});
		}
	});
});

describe('a film id sent for a release of numbered episodes', () => {
	// zurg-usenet sent tt0117579, the 1996 film Second Chance, for an eleven-episode release, and
	// rex-fun showed the film eleven times (2026-11-01; see the fixtures README)
	const [secondChance] = fun1101.cases;

	it('places none of the episodes as that film', async () => {
		const { releases, complete } = await place(
			[secondChance.request as PlaceRequest],
			Infinity,
			recordedSources(fun1101.answers),
			async (list) =>
				list.map(({ name }) => (fun1101.answers.identify as any)?.[name] ?? null)
		);
		expect(complete).toBe(true);
		expect(releases[0].kind).toBeNull();
		expect(releases[0]).toEqual(secondChance.expect);
	});

	it('places them on the show TVDB names by its title and year where TMDB names it only in Japanese', async () => {
		// TMDB titles the 1995 TBS drama (130211) only `セカンド．チャンス`; TVDB (342780) names it
		// Second Chance in English and links TMDB's id (2026-11-10)
		const [real] = secondChanceTvdb.cases;
		const { releases } = await place(
			[real.request as PlaceRequest],
			Infinity,
			recordedSources(secondChanceTvdb.answers),
			async (list) =>
				list.map(({ name }) => (secondChanceTvdb.answers.identify as any)?.[name] ?? null)
		);
		expect(releases[0].files.map((f) => [f.path.slice(14, -4), f.season, f.episode])).toEqual([
			...Array.from({ length: 12 }, (_, n) => [String(n + 1).padStart(2, '0'), 1, n + 1]),
			// naming no number or title, the one special TMDB lists (1996-12-20)
			['SP', 0, 1],
		]);
		expect(releases[0]).toEqual(real.expect);
	});
});

describe('a miniseries sent with its namesake film', () => {
	// issinoho_23951's zurg (2026-11-03) sent tt0083069, the TV film Shogun, and tt0218390, the 2002
	// film The Last Place on Earth, for the 1980 and 1985 miniseries, and rex filed every episode as
	// a film (card 630; see the fixtures README)
	const [shogun, lastPlace, film, extras] = namesakes.cases;
	const ask = (cases: (typeof namesakes.cases)[number][]) =>
		place(
			cases.map((c) => ({ ...(c.request as PlaceRequest), parts: true as const })),
			Infinity,
			recordedSources(namesakes.answers),
			async (list) =>
				list.map(({ name }) => (namesakes.answers.identify as any)[name] ?? null)
		);
	const numbers = (release: PlacedRelease) => release.files.map((f) => [f.season, f.episode]);

	it('places their episodes on the miniseries IMDb titles as the film', async () => {
		const { releases, complete } = await ask([shogun, lastPlace]);
		expect(complete).toBe(true);
		expect([releases[0].kind, releases[0].imdbId]).toEqual(['tv', 'tt0080274']);
		expect(numbers(releases[0])).toEqual([1, 2, 3, 4].map((e) => [1, e]));
		expect([releases[1].kind, releases[1].imdbId]).toEqual(['tv', 'tt0088551']);
		expect(numbers(releases[1])).toEqual([1, 2, 3, 4, 5, 6, 7].map((e) => [1, e]));
		expect(releases).toEqual([shogun.expect, lastPlace.expect]);
	});

	it('keeps a film of one file, and one with its featurettes, a film', async () => {
		const { releases } = await ask([film, extras]);
		expect(releases.map((r) => [r.kind, r.imdbId])).toEqual([
			['movie', 'tt1179933'],
			['movie', 'tt0101507'],
		]);
		expect(releases).toEqual([film.expect, extras.expect]);
	});
});

describe('a film neither the id sent nor the identifier names', () => {
	// zurg-usenet on fun (2026-11-09): Chaplin's shorts and other films the identifier reads as
	// other titles, which TMDB's search for the name's title in its year finds (see the fixtures README)
	const ask = (name: string) => {
		const c = filmsByTitle.cases.find((c) => c.request.name === name)!;
		return place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			recordedSources(filmsByTitle.answers),
			async (list) =>
				list.map(({ name }) => (filmsByTitle.answers.identify as any)[name] ?? null)
		).then(({ releases }) => [releases[0], c.expect] as const);
	};

	it.each([
		['The.Bank.1915.1080p.BluRay.x265.Garshasp', 'tt0004936', 53410],
		// a file named by a hash, as the release
		['The.Immigrant.1917.1080p.BluRay.REMUX.AVC.DD.2.0-BHD', 'tt0008133', 47653],
		// TMDB spells it with an article the name leaves out: A Burlesque on Carmen
		['Burlesque.on.Carmen.1915.720p.BluRay.x264', 'tt0005077', 53415],
		// and with an apostrophe: Entr'acte
		['Entracte 1924 1080p BluRay AAC2.0 x264-CALiGARi', 'tt0014872', 44473],
		['Un.Chien.Andalou.1929.1080p.BluRay.REMUX.AVC.FLAC.2.0-EPSILON', 'tt0020530', 626],
		// two films of 2024 TMDB titles The Kingdom: the one whose original title is it, not Le Royaume
		['The.Kingdom.2024.2160p.NF.WEB-DL.AAC2.0.H.265-YODA', 'tt34798877', 1379922],
	])('names %s by TMDB title and year', async (name, imdbId, tmdbId) => {
		const [placed, expected] = await ask(name);
		expect([placed.kind, placed.imdbId, placed.tmdbId]).toEqual(['movie', imdbId, tmdbId]);
		expect(placed).toEqual(expected);
	});

	it.each([
		// TMDB lists two films of 1922 titled Pay Day
		'Pay.Day.1922.1080p.HMAX.WEB-DL.DD2.0.H.264-alfaHD',
	])('leaves %s unnamed where TMDB names no one film of it', async (name) => {
		const [placed, expected] = await ask(name);
		expect([placed.kind, placed.imdbId, placed.tmdbId]).toEqual([null, null, null]);
		expect(placed).toEqual(expected);
	});
});

describe('a fansub name written all in brackets', () => {
	// zurg-usenet on fun (2026-11-09): philosophy-raws' Samurai Champloo, its title the name's second
	// bracket, which DMM read as no title, so the anime index never named it (see the fixtures README)
	const from: PlacementSources = {
		...recordedSources(bracketed.answers),
		anime: async () =>
			buildAnimeIndex(
				buildFranchiseIndex(bracketed.answers.anime.fribb as FribbAnimeEntry[]),
				bracketed.answers.anime.titles
			),
	};
	const ask: Identify = async (list) =>
		list.map(({ name }) => (bracketed.answers.identify as any)[name] ?? null);

	it.each(bracketed.cases.map((c) => [c.request.name, c] as const))('%s', async (_, c) => {
		const { releases, complete } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			from,
			ask
		);
		expect(complete).toBe(true);
		expect([releases[0].imdbId, releases[0].tmdbId]).toEqual(['tt0423731', 1063]);
		expect(releases[0].files[0].season).toBe(1);
		expect(releases[0]).toEqual(c.expect);
	});
});

describe('titles the identifier offers, spelled as DMM reads the name', () => {
	// zurg-usenet on fun (2026-11-09): names the identifier reads on past their title, so none of the
	// titles it offers was spelled as the name (see the fixtures README)
	const from: PlacementSources = {
		...recordedSources(spelled.answers),
		anime: async () =>
			buildAnimeIndex(
				buildFranchiseIndex(spelled.answers.anime.fribb as FribbAnimeEntry[]),
				spelled.answers.anime.titles
			),
	};
	const ask: Identify = async (list) =>
		list.map(({ name }) => (spelled.answers.identify as any)[name] ?? null);
	const placedAs = async (name: string) => {
		const c = spelled.cases.find((c) => c.request.name.startsWith(name))!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			from,
			ask
		);
		expect(releases[0]).toEqual(c.expect);
		const [file] = releases[0].files;
		return [releases[0].tmdbId, file.season, file.episode, file.episodeEnd];
	};

	it('reads a hyphen-joined episode code as no part of the title', async () => {
		// `Would I Lie to You-S16E03-Shirley Ballas…` to the identifier; the British show, which alone
		// of the two Would I Lie to You? holds a season 16
		expect(await placedAs('Would.I.Lie.to.You-S16E03')).toEqual([4775, 16, 3, null]);
		expect(await placedAs('Would.I.Lie.to.You-S16E10')).toEqual([4775, 16, 10, null]);
	});

	it('reads the titles after a run of episodes as no part of the title', async () => {
		expect(await placedAs('SpongeBob.SquarePants.S05E22E23E24')).toEqual([387, 5, 22, 24]);
	});

	it("takes a show TMDB titles as DMM reads the file's name", async () => {
		// TMDB's alternative title for Digimon: Digital Monsters; the anime index makes Zero Two its
		// season 2
		expect(await placedAs('Digimon.Adventure.Zero.Two.Episode.08')).toEqual([
			31654,
			2,
			8,
			null,
		]);
	});
});

describe('a season TVDB lists under the show and TMDB as a show of its own', () => {
	// zurg-usenet on fun (2026-11-09): TVDB keeps The Wonderfully Weird World of Gumball (2025) as
	// The Amazing World of Gumball's season 7, TMDB as 291904 with no TVDB id (see the fixtures README)
	const ask = (name: string) => {
		const c = revival.cases.find((c) => c.request.name.startsWith(name))!;
		return place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			recordedSources(revival.answers),
			async () => [null]
		).then(({ releases }) => [releases[0], c.expect] as const);
	};

	it.each([
		['The.Amazing.World.of.Gumball.S07E01.The.Burger', 1, 6247731],
		['The.Amazing.World.Of.Gumball.S07E26.1080p.WEB.h264-iVy', 26, 6710497],
	])("places %s on TMDB's own show by TVDB's numbers", async (name, episode, id) => {
		const [placed, expected] = await ask(name);
		expect([placed.tmdbId, placed.imdbId, placed.tvdbId]).toEqual([
			291904,
			'tt36985473',
			248482,
		]);
		const [file] = placed.files;
		expect([file.season, file.episode, file.how, file.tmdbEpisodeId]).toEqual([
			7,
			episode,
			'tvdbSeries',
			id,
		]);
		expect(placed).toEqual(expected);
	});

	it('leaves a number neither lists where it was', async () => {
		// TVDB's season 6 ends at E44, as TMDB's does
		const [placed, expected] = await ask('The.Amazing.World.of.Gumball.S06E45');
		expect([placed.tmdbId, placed.files[0].season]).toEqual([37606, null]);
		expect(placed).toEqual(expected);
	});
});

describe("a fansub number past every episode of its cour's season", () => {
	// zurg-usenet on fun (2026-11-09): [DB]'s Gintama numbers its files by the show's run, and names
	// the year of the cour after the one they are (see the fixtures README)
	it("counts it through the show's seasons", async () => {
		const [c] = pastCour.cases;
		const { releases, complete } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			{
				...recordedSources(pastCour.answers),
				anime: async () =>
					buildAnimeIndex(
						buildFranchiseIndex(pastCour.answers.anime.fribb as FribbAnimeEntry[]),
						pastCour.answers.anime.titles
					),
			},
			async () => [null]
		);
		expect(complete).toBe(true);
		// `Gintama (2017)_-_317_` to `_328_`: TMDB's season 8, Gintama., not season 9, Gintama. (2017)
		expect(releases[0].files.map((f) => [f.season, f.episode, f.how])).toEqual(
			Array.from({ length: 12 }, (_, n) => [8, n + 1, 'absolute'])
		);
		expect(releases[0]).toEqual(c.expect);
	});
});

describe('a title with Saga in it', () => {
	// zurg on fun (2026-11-09): `[sam] Vinland Saga [BD 1080p FLAC]`, whose title DMM read as
	// Vinland, so the anime index named nothing and its 24 episodes stayed unplaced (see the fixtures README)
	it('places the episodes by the anime index', async () => {
		const [c] = saga.cases;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			{
				...recordedSources(saga.answers),
				anime: async () =>
					buildAnimeIndex(
						buildFranchiseIndex(saga.answers.anime.fribb as FribbAnimeEntry[]),
						saga.answers.anime.titles
					),
			},
			async () => [null]
		);
		expect(releases[0].files.slice(0, 24).map((f) => [f.season, f.episode])).toEqual(
			Array.from({ length: 24 }, (_, n) => [1, n + 1])
		);
		expect(releases[0]).toEqual(c.expect);
	});
});

describe('One Pace', () => {
	// fun's zurg held One Piece's IMDb id for its One Pace releases (DMM's hash list), and DMM
	// placed them as One Piece: `[One Pace][101-105] Reverse Mountain`'s two files on One Piece's
	// S1E1 and S1E2 (fun, 2026-11-09). One Pace is its own show, numbered by its own list.
	const asked = (onePaceFun.releases as PlaceRequest[]).filter((r) => r.imdbId === 'tt0388629');

	it('is numbered by its own list, never as the One Piece its id names', async () => {
		const find = vi.fn(sources.find);
		const ask = vi.fn(identify);
		const { releases, complete } = await place(
			asked,
			Infinity,
			{ ...sources, find, onePace: () => onePaceList as OnePaceCatalogue },
			ask
		);
		expect(complete).toBe(true);
		expect(find).not.toHaveBeenCalled();
		expect(ask).not.toHaveBeenCalled();
		const reverse = releases[asked.findIndex((r) => r.name.includes('Reverse Mountain'))];
		expect(reverse).toMatchObject({ kind: null, imdbId: null, tmdbId: null, anime: true });
		expect(reverse.series).toMatchObject({ key: 'onepace', title: 'One Pace' });
		expect(reverse.series!.seasons.map((s) => [s.season, s.title])).toEqual([
			[8, 'Reverse Mountain'],
		]);
		// its 01 covers 101-103, a cut One Pace has since redone as 101-102: still its 01
		expect(
			reverse.files.map((f) => [f.season, f.episode, f.series?.season, f.series?.episode])
		).toEqual([
			[null, null, 8, 1],
			[null, null, 8, 2],
		]);
		expect(releases.every((r) => r.kind === null && r.tmdbId === null)).toBe(true);
		expect(
			releases
				.flatMap((r) => r.files)
				.every((f) => f.season === null && f.tmdbEpisodeId === null)
		).toBe(true);
	});
});

describe('a film named by a show that first aired later', () => {
	// zurg-usenet on fun (2026-11-09): the ids zurg sent with three silent films name shows of the
	// same title from decades later, which hold none of them (see the fixtures README)
	it.each([
		['[1+9] - Wings.1927.1080p.BluRay.REMUX.AVC.DTS.HD.MA.5.1.PTer.par2', 'tt0018578', 28966],
		['The.Great.Train.Robbery.1903.1080p.BluRay-LAMA', 'tt0000439', 5698],
		['Behind.The.Screen.1916.1080p.Bluray.REMUX.AVC.LPCM.2.0-Atomic', 'tt0006414', 53419],
	])('names %s by TMDB title and year', async (name, imdbId, tmdbId) => {
		const c = filmsBeforeShows.cases.find((c) => c.request.name === name)!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			recordedSources(filmsBeforeShows.answers),
			async () => [null]
		);
		expect([releases[0].kind, releases[0].imdbId, releases[0].tmdbId]).toEqual([
			'movie',
			imdbId,
			tmdbId,
		]);
		expect(releases[0]).toEqual(c.expect);
	});
});

describe('a film TMDB lists under an id IMDb lists as an episode', () => {
	// zurg-usenet on fun (2026-11-09): stage recordings TMDB keeps as films and IMDb as episodes of
	// Live from Lincoln Center and Great Performances (see the fixtures README)
	it.each([
		['Falsettos.2017.1080p.AMZN.WEB-DL.DDP5.1.H.264-QOQ', 'tt7140738', 609261],
		// a file named by a hash, as the release; the Polish Makbet of 2010 aside
		['Macbeth.2010.1080p.AMZN.WEB-DL.DD.2.0.H.264-monkee', 'tt1570337', 133448],
		[
			'Rodgers.and.Hammersteins.Carousel.Live.From.Lincoln.Center.2013.1080p.WEBRip.x264-NGP',
			'tt2845166',
			408974,
		],
	])("names %s as TMDB's film", async (name, imdbId, tmdbId) => {
		const c = filmsOfEpisodes.cases.find((c) => c.request.name === name)!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			recordedSources(filmsOfEpisodes.answers),
			async (list) =>
				list.map(({ name }) => (filmsOfEpisodes.answers.identify as any)[name] ?? null)
		);
		expect([releases[0].kind, releases[0].imdbId, releases[0].tmdbId]).toEqual([
			'movie',
			imdbId,
			tmdbId,
		]);
		expect(releases[0]).toEqual(c.expect);
	});
});

describe('a film named by its title before a colon', () => {
	// zurg-usenet on fun (2026-11-09): names that leave out the subtitle TMDB titles the film with
	// (see the fixtures README)
	it.each([
		['Berlin.1927.1080p.Bluray.Remux.AVC.PCM2.0', 'tt0017668', 222],
		// a file named by a hash, as the release
		['Puffs.2018.1080p.AMZN.WEBRip.DDP5.1.x264-QOQ', 'tt9856680', 523427],
	])('names %s by TMDB title and year', async (name, imdbId, tmdbId) => {
		const c = filmsBeforeColons.cases.find((c) => c.request.name === name)!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			recordedSources(filmsBeforeColons.answers),
			async (list) =>
				list.map(({ name }) => (filmsBeforeColons.answers.identify as any)[name] ?? null)
		);
		expect([releases[0].kind, releases[0].imdbId, releases[0].tmdbId]).toEqual([
			'movie',
			imdbId,
			tmdbId,
		]);
		expect(releases[0]).toEqual(c.expect);
	});
});

describe('a film named by one of the titles its name gives apart', () => {
	// zurg-usenet on fun (2026-11-10): `High Voltage - Vergebung ist keine Option aka Asian Cops`,
	// its German and English titles beside the original (see the fixtures README)
	it('names it by the one TMDB titles so in that year', async () => {
		const c = filmsTitledApart.cases[0];
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			recordedSources(filmsTitledApart.answers),
			async (list) =>
				list.map(({ name }) => (filmsTitledApart.answers.identify as any)[name] ?? null)
		);
		expect([releases[0].kind, releases[0].imdbId, releases[0].tmdbId]).toEqual([
			'movie',
			'tt0113144',
			99582,
		]);
		expect(releases[0]).toEqual(c.expect);
	});
});

describe('a release DMM names nothing, on the show TMDB titles as it', () => {
	// zurg-usenet on fun (2026-11-09): numbered episodes the identifier reads as a film or is unsure
	// of, of shows TMDB lists several of under the name (see the fixtures README)
	const ask = async (name: string) => {
		const c = showsByTitle.cases.find((c) => c.request.name === name)!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			recordedSources(showsByTitle.answers),
			async (list) =>
				list.map(({ name }) => (showsByTitle.answers.identify as any)[name] ?? null)
		);
		expect(releases[0]).toEqual(c.expect);
		return releases[0];
	};

	it('places an episode only one of them has', async () => {
		// the 2012 series, not the 13-episode OVA of 1993
		const placed = await ask('JoJos.Bizarre.Adventure.E25.MULTi.1080p.WEB.x264-AMB3R');
		expect([placed.tmdbId, placed.files[0].season, placed.files[0].episode]).toEqual([
			45790, 1, 25,
		]);
	});

	it('places one several have on the one made for the service the name says', async () => {
		// Netflix's Korean Kingdom, beside three other Kingdoms with an S02E02
		const placed = await ask('Kingdom.S02E02.1080p.NF.WEB-DL.Atmos.DDP5.1.x264-ExREN');
		expect([placed.tmdbId, placed.files[0].season, placed.files[0].episode]).toEqual([
			70593, 2, 2,
		]);
	});

	it.each([
		'JoJos.Bizarre.Adventure.E01.MULTi.1080p.WEB.x264-AMB3R',
		'Kingdom.S02E10.1280x720.Hi10p.AAC-Obfuscated',
		// a site's scene of 21 March 2025, not episode 25 of the 2026 series Freeze
		'Freeze.25.03.21.J.Pop.Fanatic.1080p',
	])('leaves %s unnamed where nothing tells the shows apart', async (name) => {
		expect((await ask(name)).kind).toBe(null);
	});
});

describe('a fansub episode titled the show and then one of its seasons', () => {
	// zurg-usenet on fun (2026-11-10): [ANi]'s Ascendance of a Bookworm episodes, titled as TMDB
	// names the show in Taiwan and its season 2 in Hong Kong, which the anime index does not know;
	// season 1's 36 episodes hold an E21 too (see the fixtures README)
	const from: PlacementSources = {
		...recordedSources(seasonSubtitles.answers),
		anime: async () =>
			buildAnimeIndex(
				buildFranchiseIndex(seasonSubtitles.answers.anime.fribb as FribbAnimeEntry[]),
				seasonSubtitles.answers.anime.titles
			),
	};

	it.each(seasonSubtitles.cases.map((c) => [c.request.name, c] as const))(
		'places %s in that season',
		async (_, c) => {
			const { releases } = await place(
				[{ ...(c.request as PlaceRequest), parts: true }],
				Infinity,
				from
			);
			expect(releases[0]).toEqual(c.expect);
			const episode = Number(/ - (\d+) \[/.exec(c.request.files[0].path)![1]);
			expect([
				releases[0].tmdbId,
				releases[0].files[0].season,
				releases[0].files[0].episode,
			]).toEqual([91768, 2, episode]);
		}
	);
});

describe('a Chinese title naming its season', () => {
	// zurg-usenet on fun (2026-11-10): [ANi]'s `入間同學入魔了！第四季 - 20` and `- 23`, Welcome to Demon
	// School! Iruma-kun (91801) as Taiwan names it, then 第四季, "fourth season", which the name
	// parser left in the title, so the anime index never found the show (see the fixtures README)
	const from: PlacementSources = {
		...recordedSources(cjkSeasons.answers),
		anime: async () =>
			buildAnimeIndex(
				buildFranchiseIndex(cjkSeasons.answers.anime.fribb as FribbAnimeEntry[]),
				cjkSeasons.answers.anime.titles
			),
	};

	it.each(cjkSeasons.cases.map((c) => [c.request.name, c] as const))(
		'places %s in season 4',
		async (_, c) => {
			const { releases } = await place(
				[{ ...(c.request as PlaceRequest), parts: true }],
				Infinity,
				from,
				async (list) =>
					list.map(({ name }) => (cjkSeasons.answers.identify as any)[name] ?? null)
			);
			expect(releases[0]).toEqual(c.expect);
			const episode = Number(/ - (\d+) \[/.exec(c.request.files[0].path)![1]);
			expect([
				releases[0].tmdbId,
				releases[0].files[0].season,
				releases[0].files[0].episode,
			]).toEqual([91801, 4, episode]);
		}
	);
});

describe('same-named shows told apart by how long their episodes run', () => {
	// zurg-usenet on fun (2026-11-10): `JoJos.Bizarre.Adventure.E01…` to `E12`, which both of TMDB's
	// JoJo's Bizarre Adventure hold, sent with each video's length from zurg's stored probe (E06's
	// probe failed); see the fixtures README
	const ask = async (c: (typeof byRuntime.cases)[number]) =>
		(
			await place(
				[c.request as PlaceRequest],
				Infinity,
				recordedSources(byRuntime.answers),
				async (list) =>
					list.map(({ name }) => (byRuntime.answers.identify as any)[name] ?? null)
			)
		).releases[0];

	it.each(byRuntime.cases.map((c) => [c.request.name, c] as const))('%s', async (_, c) => {
		expect(await ask(c)).toEqual(c.expect);
	});

	it("places the 24-minute files on the 2012 series, not the 1993 OVA's 35-minute episodes", async () => {
		const timed = byRuntime.cases.filter((c) => 'duration' in c.request.files[0]);
		expect(timed).toHaveLength(11);
		for (const c of timed) {
			const placed = await ask(c);
			const episode = Number(/\.E(\d+)\./.exec(c.request.name)![1]);
			expect([placed.tmdbId, placed.files[0].season, placed.files[0].episode]).toEqual([
				45790,
				1,
				episode,
			]);
		}
	});

	it('leaves a file sent without its length unnamed', async () => {
		const [e06] = byRuntime.cases.filter((c) => !('duration' in c.request.files[0]));
		expect((await ask(e06)).kind).toBe(null);
	});
});

describe('a year-numbered episode titled otherwise than TMDB titles it', () => {
	// zurg on fun (2026-11-09): two MythBusters packs numbered in TVDB's years, whose titles are
	// TMDB's with more words, the show's name, or the episode's myths (see the fixtures README)
	it.each([
		['MythBusters.2004e17.Viewers choice - Christmas Special [Special].mkv', [2, 17]],
		// "End" is a release word where it opens a title
		['MythBusters.2008e19.End with a bang.mkv', [6, 19]],
		['MythBusters.2016e11.MythBusters - The Reunion.mkv', [14, 11]],
		["Smyth S2004E02 Explosive Decompression, Frog Giggin', Rear Axle.mp4", [2, 1]],
		['Smyth S2010E06 No Pain No Gain, Propane Tank Rocket.mp4', [8, 6]],
		['Smyth S2008E08 Shark Week 2008.mp4', [6, 8]],
	])('places %s', async (path, [season, episode]) => {
		const c = mythbusters.cases.find((c) => c.request.files.some((f) => f.path === path))!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			recordedSources(mythbusters.answers),
			async () => [null]
		);
		const file = releases[0].files.find((f) => f.path === path)!;
		expect([file.season, file.episode]).toEqual([season, episode]);
		expect(releases[0]).toEqual(c.expect);
	});
});

describe('a year-numbered episode titled as TMDB titles one of another year', () => {
	// zurg on fun (2026-11-10): `Streamlined Mythbusters Complete` numbers TVDB's years, whose
	// `S2007E18 Myth Evolution` (TVDB's "Myth Evolution!", aired 2007-09-05) took TMDB's S7E18 "Myth
	// Evolution" of 2009 from `S2009E18 Myth Evolution 2`, and `S2008E20 Viewer Special Threequel`
	// (aired 2008-11-19) TMDB's S0E17, the 2010 Buster's Cut (see the fixtures README)
	it.each([
		['Smyth S2007E18 Myth Evolution.mp4', [5, 18]],
		['Smyth S2009E18 Myth Evolution 2.mp4', [7, 18]],
		['Smyth S2008E20 Viewer Special Threequel.mp4', [0, 11]],
	])('places %s on an episode of its year', async (path, [season, episode]) => {
		const c = mythbusters.cases.find((c) => c.request.files.some((f) => f.path === path))!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			recordedSources(mythbusters.answers),
			async () => [null]
		);
		const file = releases[0].files.find((f) => f.path === path)!;
		expect([file.season, file.episode]).toEqual([season, episode]);
	});
});

describe('a year-numbered episode titled as TVDB titles it', () => {
	// zurg on fun (2026-11-10): the MythBusters packs title TVDB's year seasons as TVDB does, and
	// TMDB titles those episodes otherwise; TMDB aired one that day (see the fixtures README)
	it.each([
		['Smyth S2011E01 Mission Impossible Face Off.mp4', [9, 1]], // "Mission Impossible Mask"
		['Smyth S2015E01 The Simpsons Special.mp4', [13, 1]], // "The Simpsons: D'oh!"
		['Smyth S2008E01 James Bond Special Part 1.mp4', [6, 1]], // "James Bond (1)"
		['Smyth S2004E10 Scuba Diver, Car Capers.mp4', [2, 7]], // "Scuba Diver and Car Capers"
		['Smyth S2008E20 Viewer Special Threequel.mp4', [0, 11]], // "Viewers' Special Threequel"
		['MythBusters.2009e23.Mini-Myths mayhem.mkv', [7, 23]], // TVDB's "Mini Myth Mayhem"
		// TVDB's "Pirate Special" is the other part
		['MythBusters.2007e23.Pirates Special (2).mkv', [5, 23]],
	])('places %s on the episode TMDB aired that day', async (path, [season, episode]) => {
		const c = mythbusters.cases.find((c) => c.request.files.some((f) => f.path === path))!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			recordedSources(mythbusters.answers),
			async () => [null]
		);
		const file = releases[0].files.find((f) => f.path === path)!;
		expect([file.season, file.episode]).toEqual([season, episode]);
		expect(releases[0]).toEqual(c.expect);
	});
});

describe('a title TMDB writes with an accent', () => {
	// zurg on fun (2026-11-09): `Pokemon Ultimate Journeys S25 1080p`'s last file, numbered E53 and
	// titled as TMDB's S25E57 "The Rainbow and the Pokémon Master!" (see the fixtures README)
	it('places the file by its title', async () => {
		const [c] = accented.cases;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			recordedSources(accented.answers),
			async () => [null]
		);
		const file = releases[0].files.find((f) => f.path.startsWith('S25E53'))!;
		expect([file.season, file.episode, file.how]).toEqual([25, 57, 'tmdb']);
		expect(releases[0]).toEqual(c.expect);
	});
});

describe('files between two files their titles placed', () => {
	// zurg on fun (2026-11-09): [bonkai77]'s Bleach pack numbers on through the show under `(Season 2)`,
	// and six files' titles are not TMDB's (see the fixtures README)
	it('places them between the episodes those titles name', async () => {
		const [c] = betweenTitled.cases;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			{
				...recordedSources(betweenTitled.answers),
				anime: async () =>
					buildAnimeIndex(
						buildFranchiseIndex(betweenTitled.answers.anime.fribb as FribbAnimeEntry[]),
						betweenTitled.answers.anime.titles
					),
			},
			async () => [null]
		);
		// `Episode.21` to `Episode.41`: TMDB's S1E21 to S1E41, `32`, `33` and `35`-`38` among them
		expect(releases[0].files.map((f) => [f.season, f.episode])).toEqual(
			Array.from({ length: 21 }, (_, n) => [1, n + 21])
		);
		expect(releases[0]).toEqual(c.expect);
	});
});

describe('an episode TVDB and TMDB date apart, between two they pair', () => {
	// zurg on fun (2026-11-09): TVDB dates Bleach's S2E13 two days before TMDB's S1E33, so the
	// alignment of the two lists paired neither (see the fixtures README)
	const ask = async (name: string) => {
		const c = betweenPairs.cases.find((c) => c.request.name.startsWith(name))!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			{
				...recordedSources(betweenPairs.answers),
				anime: async () =>
					buildAnimeIndex(
						buildFranchiseIndex(betweenPairs.answers.anime.fribb as FribbAnimeEntry[]),
						betweenPairs.answers.anime.titles
					),
			},
			async () => [null]
		);
		expect(releases[0]).toEqual(c.expect);
		return releases[0];
	};

	it('places it between them', async () => {
		const placed = await ask('Bleach.2004.S02E13');
		expect([placed.files[0].season, placed.files[0].episode, placed.files[0].how]).toEqual([
			1,
			33,
			'aligned',
		]);
	});

	it('leaves one aired two weeks off the episode between them where it is', async () => {
		// TVDB's S11E1 "From Pork to Tofu" is not TMDB's S11E1 "Pub Grub and More"
		const placed = await ask('Diners Drive-Ins and Dives Collection');
		const file = placed.files.find((f) => f.path.includes('From Pork to Tofu'))!;
		expect(file.season).toBe(null);
	});
});

describe('an episode number left at the end of a title', () => {
	// zurg-usenet on fun (2026-11-09): `Dragonball.Z.061.1080p.BluRay…`, its one file named by a hash;
	// the name parser reads the title as Dragonball Z 061 (see the fixtures README)
	it("places the file on the show the identifier offers, by the title's number", async () => {
		const [c] = titleEpisodes.cases;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			recordedSources(titleEpisodes.answers),
			async (list) =>
				list.map(({ name }) => (titleEpisodes.answers.identify as any)[name] ?? null)
		);
		// Dragon Ball Z's 61st episode: TMDB's S2E22, its season 1 holding 39
		expect([
			releases[0].tmdbId,
			releases[0].files[0].season,
			releases[0].files[0].episode,
		]).toEqual([12971, 2, 22]);
		expect(releases[0]).toEqual(c.expect);
	});
});

describe('a segment letter joined to the episode number', () => {
	// zurg on fun (2026-11-09): `SpongeBob SquarePants S01E01B Reef Blower`, a pack numbering the
	// half-hours and lettering their segments, which TMDB lists one by one (see the fixtures README)
	it("places each segment on the TMDB episode its title names, never on the half-hour's number", async () => {
		const [c] = segmentLetters.cases;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			recordedSources(segmentLetters.answers)
		);
		const at = (name: string) => {
			const file = releases[0].files.find((f) => f.path.includes(name))!;
			return [file.season, file.episode];
		};
		expect(at('S01E01B Reef Blower')).toEqual([1, 2]);
		expect(at('S01E01C Tea at the Treedome')).toEqual([1, 3]);
		// read as `B Plankton!`, it went to the half-hour's number, TMDB's S1E2 "Reef Blower"
		expect(at('S01E02B Plankton!')).toEqual([1, 7]);
		expect(releases[0]).toEqual(c.expect);
	});
});

describe("TVDB's segments of one TMDB episode", () => {
	// zurg on fun (2026-11-09): Freakazoid, which TVDB lists by segment (34 in season 1) and TMDB by
	// half-hour, titling each by its segments (S1E1 "Five Day Forecast / Dance of Doom / Hand Man")
	const placed = async (name: string, parts = true) => {
		const c = tvdbSegments.cases.find((c) => c.request.name.startsWith(name))!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), ...(parts ? { parts: true as const } : {}) }],
			Infinity,
			recordedSources(tvdbSegments.answers),
			async () => [null]
		);
		return { release: releases[0], expect: c.expect };
	};
	const at = (release: PlacedRelease, name: string) => {
		const f = release.files.find((f) => f.path.includes(name))!;
		return [f.season, f.episode, f.episodeEnd, f.part ?? null];
	};

	it('places each segment as its part of the half-hour', async () => {
		const { release, expect: expected } = await placed('Freakazoid! (1995)');
		expect(at(release, '1x01 - Five Day Forecast')).toEqual([1, 1, null, 1]);
		expect(at(release, '1x02 - Dance of Doom')).toEqual([1, 1, null, 2]);
		// a title TMDB spells otherwise ("Freak's French Lesson") by TVDB's number alone
		expect(at(release, '1x13 - Frenching with Freakazoid')).toEqual([1, 4, null, 3]);
		// its first segment cut before the part it names is not TMDB's "The Chip: Part 1"
		expect(at(release, '1x20 - The Chip (2)')).toEqual([1, 7, null, 1]);
		expect(at(release, '1x34 - The Wrath of Guitierrez')).toEqual([1, 13, null, null]);
		// a special by its title after `Special N`, the show's name in both: S0E1 "Freakazoid: The
		// Original Freak"
		expect(at(release, 'Special 1 - Freakazoid The Original Freak')).toEqual([
			0,
			1,
			null,
			null,
		]);
		expect(release).toEqual(expected);
	});

	it('places a file of every segment of a half-hour as that episode', async () => {
		const five = await placed('Freakazoid.S01E14-E15-E16-E17-E18');
		expect(at(five.release, 'S01E14')).toEqual([1, 5, null, null]);
		const two = await placed('Freakazoid.S01E30-E31');
		expect(at(two.release, 'S01E30')).toEqual([1, 11, null, null]);
		expect(two.release).toEqual(two.expect);
	});

	it('leaves a later segment unplaced for a caller that does not read parts', async () => {
		const { release } = await placed('Freakazoid! (1995)', false);
		expect(at(release, '1x01 - Five Day Forecast')).toEqual([1, 1, null, null]);
		expect(at(release, '1x02 - Dance of Doom')).toEqual([null, null, null, null]);
	});
});

describe("a release's SD tag after a title", () => {
	// zurg on fun (2026-11-09): Animaniacs' `5x13 - Punchline - The Chicken or the Egg - SD DVD`, a
	// pack numbered otherwise than TMDB, whose titles name its episodes (see the fixtures README)
	it('places each file on the episode its title names, the tag left out of the title', async () => {
		const [c] = releaseTags.cases;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			recordedSources(releaseTags.answers)
		);
		const at = (name: string) => {
			const file = releases[0].files.find((f) => f.path.includes(name))!;
			return [file.season, file.episode];
		};
		expect(at('5x13 - Punchline - The Chicken or the Egg')).toEqual([5, 18]);
		expect(at('5x15 - Hooray for North Hollywood (1)')).toEqual([5, 11]);
		// read with `sd` as their titles' last word, these went by their numbers
		expect(at('5x12 - Punchline - Why did the Chicken Cross the Road')).toEqual([5, 16]);
		expect(at('5x16 - Hooray for North Hollywood (2)')).toEqual([5, 12]);
		expect(releases[0]).toEqual(c.expect);
	});
});

describe('a file holding segments TMDB lists one by one', () => {
	// zurg on fun (2026-11-09): half-hours of two segments, titled by both (`Tutoring Torvald +
	// Gerald Comes Over`, `Robin Brain, The Mummy`), of shows TMDB lists by segment
	const placed = async (name: string) => {
		const c = segmentTitles.cases.find((c) => c.request.name === name)!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			recordedSources(segmentTitles.answers),
			async () => [null]
		);
		return { release: releases[0], expect: c.expect };
	};
	const at = (release: PlacedRelease, name: string) => {
		const f = release.files.find((f) => f.path.includes(name))!;
		return [f.season, f.episode, f.episodeEnd];
	};

	it('places the file on the run of episodes its segments name', async () => {
		const arnold = await placed('Hey Arnold! Season 1 1080p');
		// "6th Grade Girls" is titled otherwise; "The Baseball" is TMDB's S1E10, aired the same day
		expect(at(arnold.release, 'S01E05 - Sixth Grade Girls - The Baseball')).toEqual([1, 9, 10]);
		expect(arnold.release).toEqual(arnold.expect);
		const brain = await placed('Pinky and the Brain Complete collection');
		// TMDB's S2E10 "The Mummy" and S2E11 "Robin Brain"
		expect(at(brain.release, 'S2E5 E6 - Robin Brain, The Mummy')).toEqual([2, 10, 11]);
		// placed by its numbers on S2E10-E11 before, which its titles are not
		expect(at(brain.release, 'A Little Off the Top, Megalomaniacs Anonymous')).toEqual([
			2, 8, 9,
		]);
		expect(brain.release).toEqual(brain.expect);
		const jimmy = await placed('The Adventures of Jimmy Neutron - Boy Genius');
		expect(at(jimmy.release, 'S01E11 - Saftey First; Crime Sheen Investigation')).toEqual([
			1, 20, 21,
		]);
		// "Journey to the Center of Carl" is S1E22, "Professor Calamitous, I Presume" S1E27: no run
		expect(at(jimmy.release, 'S01E12 - Professor Calamitous')).toEqual([null, null, null]);
		expect(jimmy.release).toEqual(jimmy.expect);
	});

	it('reads no segment out of a title in parentheses', async () => {
		// `Блуи S3E01 - Идеально (англ. Perfect)`: the English title is no second segment
		const bluey = await placed('Bluey season 3');
		expect(at(bluey.release, 'S3E01 - Идеально')).toEqual([3, 1, null]);
		expect(bluey.release).toEqual(bluey.expect);
	});
});

describe("a segment title with an abbreviation's period", () => {
	// zurg on fun (2026-11-10): a period after `vs`, `Mr`, `Dr` or `No` ended a segment, so
	// `Harold vs. Patty - Rich Guy` read as three titles and `Hungarian Rhapsody No. 6` left a
	// segment `6`, and their files were placed on one segment or none
	const placed = async (name: string) => {
		const c = segmentAbbreviations.cases.find((c) => c.request.name.startsWith(name))!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true, shows: true }],
			Infinity,
			recordedSources(segmentAbbreviations.answers),
			async (list) =>
				list.map(({ name }) => (segmentAbbreviations.answers.identify as any)[name] ?? null)
		);
		expect(releases[0]).toEqual(c.expect);
		return (part: string) => {
			const f = releases[0].files.find((f) => f.path.includes(part))!;
			return [f.season, f.episode, f.episodeEnd];
		};
	};

	it('reads the title on past the period', async () => {
		const arnold = await placed('Hey Arnold! 576p');
		// TMDB's S5E23 "Harold vs. Patty" and S5E24 "Rich Guy"
		expect(arnold('S05E11_Harold vs. Patty - Rich Guy')).toEqual([5, 23, 24]);
		// placed on "Ghost Bride" alone before
		expect(arnold('S05E08_Ghost Bride - Gerald vs. Jamie O')).toEqual([5, 37, 38]);
		const mickey = await placed('[M-KV2501] Mickey Mouse Works');
		// TMDB's S1E20 "Maestro Minnie: Hungarian Rhapsody No. 6" to S1E23 "Pluto's Kittens"
		expect(mickey('1x05 (05) Hungarian Rhapsody No. 6')).toEqual([1, 20, 23]);
		expect(mickey('1x06 (06) Remote Controlled Laser Lawn Mower; Pluto Vs.')).toEqual([
			1, 24, 27,
		]);
	});

	it('places a run of segments TMDB lists in another season', async () => {
		// TMDB counts Mickey Mouse Works' first season to `1x08`; its S2E5-E9 are `1x10`'s segments
		const mickey = await placed('[M-KV2501] Mickey Mouse Works');
		expect(mickey('1x10 (10) Street Cleaner')).toEqual([2, 5, 9]);
		expect(mickey('2x11 (24) Vending Machine')).toEqual([3, 10, 13]);
		// "Hansel and Gretel" and "Mickey's Mechanical House" are each two of TMDB's season 2:
		// one segment alone names no run elsewhere
		expect(mickey('1x09 (09) Rock Climbing')).toEqual([null, null, null]);
		// the JHS pack's `S11E01.Spot.ReturnsThe.Check-Up` is TMDB's S10E17-E18
		const c = runTogether.cases.find((c) =>
			c.request.name.startsWith('Spongebob.Squarepants.S11')
		)!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true, shows: true }],
			Infinity,
			recordedSources(runTogether.answers),
			async () => [null]
		);
		const spot = releases[0].files.find((f) => f.path.includes('S11E01.Spot.Returns'))!;
		expect([spot.season, spot.episode, spot.episodeEnd]).toEqual([10, 17, 18]);
	});

	it('places a pack already in the corpus the same way', async () => {
		const c = fun1024.cases.find((c) => c.request.name.startsWith('[TV] Hey Arnold!'))!;
		const { releases } = await place([c.request as PlaceRequest], Infinity, {
			...recordedSources(fun1024.answers),
			anime: async () =>
				buildAnimeIndex(
					buildFranchiseIndex(fun1024.answers.anime.fribb as FribbAnimeEntry[]),
					fun1024.answers.anime.titles
				),
		});
		const f = releases[0].files.find((f) => f.path.includes('Harold vs. Patty + Rich Guy'))!;
		expect([f.season, f.episode, f.episodeEnd]).toEqual([5, 23, 24]);
	});
});

describe('segment titles run together with no mark between them', () => {
	// zurg-usenet on fun (2026-11-10): the JHS SpongeBob packs write each half-hour's two titles as
	// one (`Drive.HappyOld.Man.Patrick`), which TMDB lists as two episodes; read as one title they
	// placed nothing, and the packs' files went by their numbers onto episodes they do not hold
	const placed = async (name: string) => {
		const c = runTogether.cases.find((c) => c.request.name.startsWith(name))!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true, shows: true }],
			Infinity,
			recordedSources(runTogether.answers),
			async () => [null]
		);
		expect(releases[0]).toEqual(c.expect);
		return (part: string) => {
			const f = releases[0].files.find((f) => f.path.includes(part))!;
			return [f.season, f.episode, f.episodeEnd];
		};
	};

	it('places the file on the run its titles divide into', async () => {
		const eleven = await placed('Spongebob.Squarepants.S11');
		// TMDB's S11E20 "Drive Happy" and S11E21 "Old Man Patrick"
		expect(eleven('S11E11.Drive.HappyOld.Man.Patrick')).toEqual([11, 20, 21]);
		// TMDB's S11E13 "Cuddle E. Hugs" and S11E17 "Pat the Horse" are no run: by its number on
		// S11E5 "Feral Friends" before
		expect(eleven('S11E09.Cuddle.E.HugsPat.the.Horse')).toEqual([null, null, null]);
		const thirteen = await placed('Spongebob.Squarepants.S13');
		// TMDB's S13E47 "Hot Crossed Nuts" and S13E48 "Sir Urchin and Snail Fail"
		expect(thirteen('S13E17.Hot.Crossed.Nuts.Sir.Urchin.and.Snail.Fail')).toEqual([13, 47, 48]);
		// three titles, TMDB's S13E34-E36; by its number on S13E12 "Plankton's Intern" before
		expect(thirteen('S13E12.Welcome.to.Binary.Bottom')).toEqual([13, 34, 36]);
		// on S13E10 "Squidward's Sick Daze" before
		expect(thirteen('S13E10.Captain.Pipsqueak.Plane.to.Sea')).toEqual([13, 30, 31]);
	});
});

describe("a special numbered as a season's film", () => {
	// zurg on fun and DMM's PlacementMiss (2026-11-10): one uploader numbers a show's TV films and
	// compilations `S1M1`, `S08M01`, which name no episode, before the film's title
	const placed = async (name: string) => {
		const c = filmNumbered.cases.find((c) => c.request.name.startsWith(name))!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true, shows: true }],
			Infinity,
			recordedSources(filmNumbered.answers),
			async () => [null]
		);
		expect(releases[0]).toEqual(c.expect);
		return (part: string) => {
			const f = releases[0].files.find((f) => f.path.includes(part))!;
			return [f.season, f.episode, f.episodeEnd];
		};
	};
	it('places it by the title after the number among the specials', async () => {
		const wood = await placed('The Animals of Farthing Wood');
		// TMDB's S0E1-E3, the video compilations of season 1 (82-87 minutes each)
		expect(wood('S1M1 - The Journey Begins')).toEqual([0, 1, null]);
		expect(wood('S1M3  - On to White Deep Park')).toEqual([0, 3, null]);
		const murder = await placed('Diagnosis Murder');
		// TMDB's S0E4 "Town Without Pity", a TV film after season 8
		expect(murder('S08M01 Town Without Pity')).toEqual([0, 4, null]);
		expect(murder('S00M01 Diagnosis of Murder')).toEqual([0, 1, null]);
	});
});

describe('a file its name dates before the show began', () => {
	// zurg on fun (2026-11-10): a pack of 1979's Buck Rogers in the 25th Century carries the 1939
	// serial's chapters (`Buck Rogers 1939 E02 Tragedy on Saturn`), twice; by their numbers E02 and
	// E04 landed on the 1979 show's S1E2 and S1E4, which other files' titles left free
	const placed = async (name: string) => {
		const c = serialPack.cases.find((c) => c.request.name.startsWith(name))!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true, shows: true }],
			Infinity,
			recordedSources(serialPack.answers),
			async () => [null]
		);
		expect(releases[0]).toEqual(c.expect);
		return (part: string) => {
			const f = releases[0].files.find((f) => f.path.includes(part))!;
			return [f.season, f.episode, f.episodeEnd];
		};
	};
	it("places it on none of the show's episodes", async () => {
		const buck = await placed('Buck Rogers in the 25th Century');
		expect(buck(' Buck Rogers 1939 E02 Tragedy on Saturn')).toEqual([null, null, null]);
		expect(buck(' Buck Rogers 1939 E04 The Sky Patrol')).toEqual([null, null, null]);
	});
});

describe("a special TMDB titles with an article before the show's name", () => {
	// zurg on fun (2026-11-10): Robot Chicken's `S07E16 Bitch Pudding Special` is TMDB's S0E14 "The
	// Robot Chicken Bitch Pudding Special"; the show's name was looked for at the title's start only
	const placed = async (name: string) => {
		const c = articleShows.cases.find((c) => c.request.name.startsWith(name))!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true, shows: true }],
			Infinity,
			recordedSources(articleShows.answers),
			async () => [null]
		);
		expect(releases[0]).toEqual(c.expect);
		return (part: string) => {
			const f = releases[0].files.find((f) => f.path.includes(part))!;
			return [f.season, f.episode, f.episodeEnd];
		};
	};
	it('places the file on it', async () => {
		const chicken = await placed('Robot Chicken (2005-2020)');
		expect(chicken('S07E16 Bitch Pudding Special')).toEqual([0, 14, null]);
	});
});

describe("a title after the release's tags in parentheses", () => {
	// zurg on fun (2026-11-10): `Star.Wars.The.Clone.Wars.-.S01E01.-.PGor.-.(BD-Rip.1080p…).Ambush`
	// read as titled `PGor`, which names no episode, so the pack numbered as TheTVDB does and two
	// files were unplaced, two others on runs they do not hold
	const placed = async (name: string) => {
		const c = tagsBeforeTitles.cases.find((c) => c.request.name.startsWith(name))!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true, shows: true }],
			Infinity,
			recordedSources(tagsBeforeTitles.answers),
			async () => [null]
		);
		expect(releases[0]).toEqual(c.expect);
		return (part: string) => {
			const f = releases[0].files.find((f) => f.path.includes(part))!;
			return [f.season, f.episode, f.episodeEnd];
		};
	};
	it('places the file where that title names the episode at its number', async () => {
		const wars = await placed('Star.Wars.The.Clone.Wars.-.S01');
		expect(wars('S01E01.-.PGor')).toEqual([1, 1, null]);
		expect(wars('S01E17.-.PGor')).toEqual([1, 17, null]);
		// on S1E1-E2 before
		expect(wars('S01E02.-.PGor')).toEqual([1, 2, null]);
	});
});

describe('a special named by its title', () => {
	// zurg on fun and DMM's PlacementMiss (2026-11-09): specials numbered as a season's E00, named
	// after a season alone, or titled by the segments TMDB titles them by (see the fixtures README)
	const placed = async (name: string) => {
		const c = specialsByTitle.cases.find((c) => c.request.name.startsWith(name))!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			recordedSources(specialsByTitle.answers),
			async () => [null]
		);
		expect(releases[0]).toEqual(c.expect);
		return (part: string) => {
			const f = releases[0].files.find((f) => f.path.includes(part))!;
			return [f.season, f.episode];
		};
	};

	it("places a season's E00 by the title after it", async () => {
		const archer = await placed('Archer.2009.S01-S14');
		// TMDB's S0E3-E5 "Heart of Archness (1)"-"(3)"
		expect(archer('S03E00.Heart.of.Archness,Pt.1')).toEqual([0, 3]);
		expect(archer('S03E00.Heart.of.Archness,Pt.3')).toEqual([0, 5]);
		const who = await placed('Doctor.Who.2023.S02E00.Joy.to.the.World');
		expect(who('S02E00')).toEqual([0, 5]);
	});

	it('places a special named after a season alone by the title after it', async () => {
		const wilty = await placed('Would I Lie to You');
		// TMDB's S0E5 "Children in Need (Series 10)"
		expect(wilty('S10 - Children in Need Special')).toEqual([0, 5]);
	});

	it('places a special titled by its segments', async () => {
		const darkness = await placed('[KH] To Love-Ru Darkness');
		expect(darkness('OVA - 01 - Prologue - Pollen Plan - Body touch')).toEqual([0, 7]);
		expect(darkness('OVA - 02 - Nostalgia - The Changing Heart - Flower')).toEqual([0, 8]);
		expect(darkness('OVA - 03 - Exchange - It feels')).toEqual([0, 9]);
	});
});

describe('an OVA numbered and titled', () => {
	// zurg on fun (2026-11-10): Anime Time's Fairy Tail pack titles its OVAs after their numbers,
	// `Fairy Tail - OVA 1 - Welcome To Fairy Hills!!` (see the fixtures README)
	const placed = async (name: string) => {
		const c = fairyTail.cases.find((c) => c.request.name.startsWith(name))!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true, shows: true }],
			Infinity,
			{
				...recordedSources(fairyTail.answers),
				anime: async () =>
					buildAnimeIndex(
						buildFranchiseIndex(fairyTail.answers.anime.fribb as FribbAnimeEntry[]),
						fairyTail.answers.anime.titles
					),
			},
			async () => [null]
		);
		expect(releases[0]).toEqual(c.expect);
		return (part: string) => {
			const f = releases[0].files.find((f) => f.path.includes(part))!;
			return [f.season, f.episode];
		};
	};

	it("places each on TMDB's special of that title", async () => {
		const pack = await placed('[Anime Time] Fairy Tail Complete Series');
		// TMDB's S0E1-E9, "Welcome to Fairy Hills!!" to "Fairies' Christmas"
		expect(pack('OVA 1 - Welcome To Fairy Hills!!')).toEqual([0, 1]);
		expect(pack('OVA 3 - Memory Days')).toEqual([0, 3]);
		expect(pack('OVA 8 - Natsu vs. Mavis')).toEqual([0, 8]);
		expect(pack("OVA 9 - Fairies' Christmas")).toEqual([0, 9]);
	});

	it("places one titled with the show's name", async () => {
		// TMDB's S0E6 "Fairy Tail x Rave"
		const pack = await placed('[Anime Time] Fairy Tail Complete Series');
		expect(pack('OVA 6 - Fairy Tail x Rave')).toEqual([0, 6]);
	});

	it('places one whose title says "and" in Japanese', async () => {
		// TMDB's S0E2 "Fairy Academy: Yankee-kun and Yankee-chan"
		const pack = await placed('[Anime Time] Fairy Tail Complete Series');
		expect(pack('OVA 2 - Fairy Academy Yankee-Kun To Yankee-Chan')).toEqual([0, 2]);
	});

	// the Tsuki release as zurg asks it: the OVAs its season map could not number carry its `-other`
	it("places OVAs under zurg's mark by the numbers the anime dataset gives Fairy Tail OVA", async () => {
		// anidb 8132 "Fairy Tail OVA" is TMDB's season 0 from its first episode
		const ova = await placed('[Tsuki-Hatsuyuki-Kaitou]_Fairy_Tail_OVA-Movie');
		expect(ova('OVA_-_01_')).toEqual([0, 1]);
		expect(ova('OVA_-_05_')).toEqual([0, 5]);
	});

	it("places one under zurg's mark titled with the show's name before the word", async () => {
		// `Fairy_Tail_x_Rave_OVA_-_06_[DVD]…-other` is TMDB's S0E6 "Fairy Tail x Rave"
		const ova = await placed('[Tsuki-Hatsuyuki-Kaitou]_Fairy_Tail_OVA-Movie');
		expect(ova('Fairy_Tail_x_Rave_OVA_-_06_')).toEqual([0, 6]);
	});

	it("answers the film and its prologue in the release as TMDB's two films", async () => {
		// the release names a film and its files no film word or year; TMDB titles the 12-minute
		// prologue "Phoenix Priestess - The First Morning", in the US "…Movie Prologue: Phoenix Priestess…"
		await placed('[Tsuki-Hatsuyuki-Kaitou]_Fairy_Tail_OVA-Movie');
		const c = fairyTail.cases.find((c) => c.request.name.startsWith('[Tsuki'))!;
		const films = c.expect.files.filter((f) => f.path.includes('Phoenix_Priestess'));
		expect(
			films.map((f) => [f.path.includes('(Prologue)'), (f as any).tmdbId, (f as any).imdbId])
		).toEqual([
			[true, 592072, 'tt16606636'],
			[false, 135531, 'tt2085795'],
		]);
	});
});

describe('an OVA named by its show and season alone', () => {
	// zurg on fun (2026-11-10): fansub OVAs named by the season they follow and no title, beside that
	// season's episodes or alone (see the fixtures README)
	const placed = async (name: string) => {
		const c = seasonOvas.cases.find((c) => c.request.name.startsWith(name))!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true, shows: true }],
			Infinity,
			{
				...recordedSources(seasonOvas.answers),
				anime: async () =>
					buildAnimeIndex(
						buildFranchiseIndex(seasonOvas.answers.anime.fribb as FribbAnimeEntry[]),
						seasonOvas.answers.anime.titles
					),
			},
			async () => [null]
		);
		expect(releases[0]).toEqual(c.expect);
		return (part: string) => {
			const f = releases[0].files.find((f) => f.path.includes(part))!;
			return [f.season, f.episode];
		};
	};

	it("places it on the first special after the season's episodes the release holds", async () => {
		// DanMachi III ended 2020-12-19; S0E4 (2021-04-28, 27 minutes) comes before S0E5 (2022-07-09)
		const third = await placed(
			'[sam] Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka III'
		);
		expect(third('III - OVA v2')).toEqual([0, 4]);
		// a creditless ending is no OVA
		expect(third('III - OVA - NCED')).toEqual([null, null]);
		// Durarara!!x2 Shou is TMDB's S2E1-12, Ten its S2E13-24: S0E3 follows the one, S0E4 the other
		expect((await placed('[YURI] Durarara!!x2 Shou'))('Shou OVA')).toEqual([0, 3]);
		expect((await placed('Durarara!!x2_Ten_'))('Ten - OVA')).toEqual([0, 4]);
	});

	it('places one of a release of OVAs by the season its name gives, as long as the file', async () => {
		const oads = await placed('[Commie] Haikyuu!! OADs');
		// S0E1 "Lev Appears!", not the four-minute picture dramas aired after season 1
		expect(oads('Haikyuu!! - OAD')).toEqual([0, 1]);
		expect(oads('Second Season - OAD')).toEqual([0, 2]);
		// season 3 by TMDB's name for it
		expect(oads('Shiratorizawa Academy - OAD')).toEqual([0, 3]);
	});

	it('places numbered ones in turn among the specials as long as them', async () => {
		const ovas = await placed('[MTBB] Asobi Asobase OVAs');
		// five-minute S0E1 and S0E2, the 13-minute S0E3
		expect(ovas('OVA1')).toEqual([0, 1]);
		expect(ovas('OVA2')).toEqual([0, 2]);
		expect(ovas('OAD')).toEqual([0, 3]);
	});
});

describe('a special titled before the subtitle TMDB gives it', () => {
	// zurg-usenet on fun (2026-11-10): `[MiniMTBB].SteinsGate.0.S1.BD.1080p` (see the fixtures README)
	it("places it on TMDB's special of that title, and no file by a number TMDB's list lacks", async () => {
		const c = subtitledSpecials.cases[0];
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true, shows: true }],
			Infinity,
			{
				...recordedSources(subtitledSpecials.answers),
				anime: async () =>
					buildAnimeIndex(
						buildFranchiseIndex(
							subtitledSpecials.answers.anime.fribb as FribbAnimeEntry[]
						),
						subtitledSpecials.answers.anime.titles
					),
			},
			async (list) =>
				list.map(({ name }) => (subtitledSpecials.answers.identify as any)[name] ?? null)
		);
		expect(releases[0]).toEqual(c.expect);
		const at = (part: string) => {
			const f = releases[0].files.find((f) => f.path.includes(part))!;
			return [f.season, f.episode];
		};
		// TMDB's S0E1 "Valentine's of Crystal Polymorphism -Bittersweet Intermedio-", numbered S00E02
		expect(at("S00E02 - Valentine's of Crystal Polymorphism")).toEqual([0, 1]);
		// the original series' Episode 23β, which Steins;Gate 0's specials do not list, is not S0E1
		expect(at('S00E01 - Episode 23β')).toEqual([null, null]);
	});
});

describe("TMDB's title with the show's name before it", () => {
	// zurg on fun (2026-11-09): files titled without the show's name TMDB titles them with, or with
	// the show's name TMDB titles them without (see the fixtures README)
	const placed = async (name: string) => {
		const c = showNamedTitles.cases.find((c) => c.request.name.startsWith(name))!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			recordedSources(showNamedTitles.answers),
			async () => [null]
		);
		expect(releases[0]).toEqual(c.expect);
		return (part: string) => {
			const f = releases[0].files.find((f) => f.path.includes(part))!;
			return [f.season, f.episode];
		};
	};

	it('places a file on the episode titled as it with the show named first', async () => {
		// TMDB's S0E13 "Ed, Edd n Eddy's Big Picture Show"
		expect(
			(await placed('Ed, Edd n Eddy (1999) Season 6'))('S00E05 - Big Picture Show')
		).toEqual([0, 13]);
		// TMDB's S0E1 "Odd Taxi Picture Drama", the title in brackets after the number
		expect((await placed('[Anime Time] Odd Taxi'))('S00E14 [Picture Drama]')).toEqual([0, 1]);
	});

	it("places a file titled with the show's name on the episode titled without it", async () => {
		const dark = await placed('Are You Afraid Of The Dark Complete Series');
		// TMDB's S1E1 "The Tale of the Phantom Cab"
		expect(dark('-01 Are You Afraid of the Dark - The Tale of the Phantom Cab')).toEqual([
			1, 1,
		]);
		expect(dark('-13 Are You Afraid of the Dark - The Tale of the Pinball Wizard')).toEqual([
			1, 13,
		]);
	});
});

describe('a part of the episode its title names', () => {
	// zurg on fun (2026-11-09): two Star Wars Rebels season 2 packs, each with `The.Siege.of.Lothal`
	// in two files (`Part1`, `Part2`), TMDB's one 44-minute special S0E6 (see the fixtures README)
	const placed = async (name: string, parts: boolean) => {
		const c = titleParts.cases.find((c) => c.request.name.startsWith(name))!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), ...(parts ? { parts: true as const } : {}) }],
			Infinity,
			recordedSources(titleParts.answers),
			async () => [null]
		);
		if (parts) expect(releases[0]).toEqual(c.expect);
		return (name: string) => {
			const f = releases[0].files.find((f) => f.path.includes(name))!;
			return [f.season, f.episode, f.part ?? null];
		};
	};

	it("places each file as its part of TMDB's episode", async () => {
		const nogrp = await placed('Star.Wars.Rebels.S02.1080p.BluRay.REMUX.AVC.DD5.1-NOGRP', true);
		expect(nogrp('S02E01.The.Siege.of.Lothal.Part1')).toEqual([0, 6, 1]);
		expect(nogrp('S02E02.The.Siege.of.Lothal.Part2')).toEqual([0, 6, 2]);
		const privatehd = await placed('Star.Wars.Rebels.S02.1080p.BluRay.REMUX.AVC.DD.5.1', true);
		expect(privatehd('S02E01.The.Siege.of.Lothal.Part2')).toEqual([0, 6, 2]);
	});

	it('leaves a later part unplaced for a caller that does not read parts', async () => {
		const nogrp = await placed(
			'Star.Wars.Rebels.S02.1080p.BluRay.REMUX.AVC.DD5.1-NOGRP',
			false
		);
		expect(nogrp('S02E01.The.Siege.of.Lothal.Part1')).toEqual([0, 6, null]);
		expect(nogrp('S02E02.The.Siege.of.Lothal.Part2')).toEqual([null, null, null]);
	});
});

describe("a film in a show's release, by the identifier's answer", () => {
	// zurg on fun and DMM's PlacementMiss (2026-11-09): films in releases placed on a show, whose
	// titles differ from the show's by a number, an article or the film's number in the series
	const films = async (name: string) => {
		const c = filmsInShows.cases.find((c) => c.request.name.startsWith(name))!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			recordedSources(filmsInShows.answers),
			async () => [null]
		);
		expect(releases[0]).toEqual(c.expect);
		return releases[0].files.flatMap((f) => (f.kind ? [[f.imdbId, f.tmdbId]] : []));
	};

	it('names a film titled as the show and a number', async () => {
		// JUJUTSU KAISEN 0 (2021), the release's one file, sent with the show's id
		expect(await films('[RaptoR] Jujutsu Kaisen 0 (2021)')).toEqual([['tt14331144', 810693]]);
	});

	it('names a film whose title has an article or a number the name leaves out', async () => {
		// "Ranma ½: The Movie, Big Trouble in Nekonron, China", "Ranma ½: The Movie 2, Nihao My Concubine"
		expect(await films('[Exiled-Destiny]_Ranma')).toEqual([
			['tt0101583', 37024],
			['tt0104604', 37021],
		]);
	});

	it("names a release's one file the identifier is sure is a film", async () => {
		expect(await films('Deadpool')).toEqual([['tt6263850', 533535]]);
	});
});

describe("a film titled as the show and the file's own words", () => {
	// zurg on fun (2026-11-09): films in releases placed on a show, no identifier answer naming them,
	// which TMDB titles as the show and the words the file names beyond it (see the fixtures README)
	const film = async (name: string, part?: string) => {
		const c = filmsTitledByShow.cases.find((c) => c.request.name.startsWith(name))!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			{
				...recordedSources(filmsTitledByShow.answers),
				anime: async () =>
					buildAnimeIndex(
						buildFranchiseIndex(
							filmsTitledByShow.answers.anime.fribb as FribbAnimeEntry[]
						),
						filmsTitledByShow.answers.anime.titles
					),
			},
			async (list) =>
				list.map(({ name }) => (filmsTitledByShow.answers.identify as any)?.[name] ?? null)
		);
		expect(releases[0]).toEqual(c.expect);
		const f = releases[0].files.find((f) => !part || f.path.includes(part))!;
		return [f.kind ?? null, f.tmdbId ?? null];
	};

	it("names a fansub's film by the words after its title", async () => {
		// "Kaiju No. 8: Mission Recon" (2025), the release sent with the show's id
		expect(await film('[SubsPlease] Kaijuu 8-gou - Mission Recon')).toEqual(['movie', 1326106]);
		// "Non Non Biyori Vacation" (2018)
		expect(await film('[Erai-raws] Non Non Biyori - Vacation - Movie')).toEqual([
			'movie',
			494471,
		]);
		// "Fate/kaleid liner Prisma☆Illya: Prisma☆Phantasm" (2019)
		expect(await film('[Arid] Fate kaleid liner')).toEqual(['movie', 658436]);
	});

	it("names a pack's film numbered as a special by the words after the show's", async () => {
		// "My Hero Academia: Two Heroes" (2018), not TMDB's S0E4 "All Might: Rising"
		expect(
			await film(
				'[Tenrai-Sensei] My Hero Academia',
				'S00E04 - My Hero Academia The Movie The Two Heroes'
			)
		).toEqual(['movie', 505262]);
	});
});

describe("a director's cut's prime after a fansub's number", () => {
	// zurg on fun (2026-11-09): `[Sephirotic] Evangelion - 21' [MULTI]…`, the pack's only copies of
	// episodes 21-24 (see the fixtures README)
	it('places the file on the episode it numbers', async () => {
		const [c] = directorsCuts.cases;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			{
				...recordedSources(directorsCuts.answers),
				anime: async () =>
					buildAnimeIndex(
						buildFranchiseIndex(directorsCuts.answers.anime.fribb as FribbAnimeEntry[]),
						directorsCuts.answers.anime.titles
					),
			},
			async () => [null]
		);
		const at = (name: string) => {
			const f = releases[0].files.find((f) => f.path.includes(name))!;
			return [f.season, f.episode];
		};
		expect(at("Evangelion - 21' [MULTI]")).toEqual([1, 21]);
		expect(at("Evangelion - 24' [MULTI]")).toEqual([1, 24]);
		expect(releases[0]).toEqual(c.expect);
	});
});

describe('a title whose last word is as short as an extension', () => {
	// zurg on fun (2026-11-10): the title reader took the last word of a name already cut from its
	// extension for another one, so `the.crocodile.hunter.s02e07.where.devils.run.wild` read "Where
	// Devils Run", TMDB's S2E6 "Where the Devils Run Wild" nothing, and `s08e05.tigers.of.shark.bay`
	// "Tigers of Shark", which IMDb's numbers placed on S5E6 "They Shoot Crocodiles, Don't They?"
	const at = async (fixture: any, name: string, path: string, parts: boolean) => {
		const c = fixture.cases.find((c: any) => c.request.name.startsWith(name))!;
		const { releases } = await place(
			[parts ? { ...(c.request as PlaceRequest), parts: true } : (c.request as PlaceRequest)],
			Infinity,
			recordedSources(fixture.answers),
			async (list) => list.map(({ name }) => fixture.answers.identify?.[name] ?? null)
		);
		const f = releases[0].files.find((f) => f.path === path)!;
		return [f.season, f.episode];
	};

	it('reads the whole title', async () => {
		const croc = 'The Crocodile Hunter';
		expect(
			await at(
				spellingVariants,
				croc,
				'the.crocodile.hunter.s02e07.where.devils.run.wild.avi',
				true
			)
		).toEqual([2, 6]);
		expect(
			await at(
				siblingShows,
				croc,
				'the.crocodile.hunter.s08e05.tigers.of.shark.bay.avi',
				false
			)
		).toEqual([5, 10]);
		expect(
			await at(
				siblingShows,
				croc,
				'the.crocodile.hunter.s08e08.they.shoot.crocodiles.dont.they.avi',
				false
			)
		).toEqual([5, 6]);
		expect(
			await at(siblingShows, croc, 'the.crocodile.hunter.s08e03.crocs.in.the.city.avi', false)
		).toEqual([5, 8]);
	});

	it("takes no title of the show aired before the release's year", async () => {
		// DMM's PlacementMiss (2026-11-10): Channel 4's 2023 series, which TMDB lists apart (87012),
		// asked with the BBC show's id (34549); read whole, `S14E02-Biscuit.Week` is TMDB's 2016 S7E2
		// "Biscuit Week" by title alone, where the name says 2023
		const name = 'The.Great.British.Bake.Off-S14';
		const c = splitShowGenericTitles.cases.find((c: any) => c.request.name.startsWith(name))!;
		const { releases } = await place(
			[c.request as PlaceRequest],
			Infinity,
			recordedSources(splitShowGenericTitles.answers),
			async () => [null]
		);
		const placed = releases[0].files.filter(
			(f) => f.season === 7 && releases[0].tmdbId === 34549
		);
		expect(placed).toEqual([]);
		expect(releases[0]).toEqual(c.expect);
	});
});

describe("a part titled as its other part's number", () => {
	// zurg on fun (2026-11-10): Married... with Children's pack numbers each two-part episode one
	// later than TMDB, and the title reader took `Poppy's By the Tree (1)` at S02E02 for TMDB's S2E2
	// "Poppy's by the Tree (2)", part numbers aside, which left the pack's `(2)` beside it; `Girls
	// Just Wanna Have Fun (1)` and `(2)` are TMDB's "Girls Just Want to Have Fun (1)" and "(2)"
	it.each([
		["S02E02 - Poppy's By the Tree (1)", [2, 1]],
		["S02E03 - Poppy's By the Tree (2)", [2, 2]],
		['S02E06 - Girls Just Wanna Have Fun (1)', [2, 5]],
		['S02E07 - Girls Just Wanna Have Fun (2)', [2, 6]],
	])('places %s on its own part', async (part, [season, episode]) => {
		const [c] = partTitlesSpoken.cases;
		const { releases } = await place(
			[c.request as PlaceRequest],
			Infinity,
			recordedSources(partTitlesSpoken.answers),
			async () => [null]
		);
		const file = releases[0].files.find((f) => f.path.includes(part))!;
		expect([file.season, file.episode]).toEqual([season, episode]);
		expect(releases[0]).toEqual(c.expect);
	});
});

describe('a release sent with the IMDb id of an episode TMDB lists as a film', () => {
	// zurg on fun (2026-11-10): stage recordings IMDb lists as episodes of anthology series, sent with
	// that id, which DMM resolved to the series and placed no file of (see the fixtures README)
	it.each([
		['Company (Raul Esparza).avi', 'tt1160997', 31020], // Company: A Musical Comedy (2008)
		['into-the-woods-1991', 'tt0099851', 23378], // Into the Woods (1991)
	])('places %s as the film', async (name, imdbId, tmdbId) => {
		const c = filmsOfSentEpisodeIds.cases.find((c) => c.request.name === name)!;
		const { releases } = await place(
			[c.request as PlaceRequest],
			Infinity,
			recordedSources(filmsOfSentEpisodeIds.answers),
			async () => [null]
		);
		expect(releases[0]).toMatchObject({ kind: 'movie', imdbId, tmdbId });
		expect(releases[0]).toEqual(c.expect);
	});
});

describe("a season's episode 0", () => {
	// zurg on fun and DMM's PlacementMiss (2026-11-10): `S15E00` read the tags after it as S2E64
	// (`H.264`), TMDB titles fourteen specials "At Christmas", Call the Midwife's names its year, and
	// King of the Road's is S1E1 (see the fixtures README)
	it.each([
		['Would.I.Lie.to.You.S15E00', [0, 12]], // "At Christmas 2021", aired between series 14 and 15
		['call.the.midwife.s11e00.christmas.special.2022', [0, 13]], // "Christmas Special 2022"
		['King.Of.The.Road.US.S01E00', [1, 1]], // "Highway to Hell: 10 Years on the Road"
	])('places %s', async (start, [season, episode]) => {
		const c = seasonZeroSpecials.cases.find((c) =>
			c.request.files.some((f) => f.path.startsWith(start))
		)!;
		const { releases } = await place(
			[c.request as PlaceRequest],
			Infinity,
			recordedSources(seasonZeroSpecials.answers),
			async () => [null]
		);
		const file = releases[0].files.find((f) => f.path.startsWith(start))!;
		expect([file.season, file.episode]).toEqual([season, episode]);
		expect(releases[0]).toEqual(c.expect);
	});
});

describe("QI's numbered specials", () => {
	// zurg on fun (2026-11-10): QI's Specials folder titles its specials by series (see the fixtures README)
	const placedAt = async (start: string) => {
		const [c] = qiNumberedSpecials.cases;
		const { releases } = await place(
			[c.request as PlaceRequest],
			Infinity,
			recordedSources(qiNumberedSpecials.answers),
			async () => [null]
		);
		expect(releases[0]).toEqual(c.expect);
		const file = releases[0].files.find((f) => f.path.startsWith(start))!;
		return [file.season, file.episode];
	};

	it("reads a number's leading zeros as none", async () => {
		// "Series 1 Bonus Bits & Bloopers"
		expect(await placedAt('QI - s00e10 - Series 01')).toEqual([0, 14]);
	});

	it('agrees no title by the one word its first segment keeps before a number', async () => {
		// `Series 03` is no "Series 2 Banter Part 1" (S0E12): "Series 3 Bonus Bits & Bloopers"
		expect(await placedAt('QI - s00e12 - Series 03')).toEqual([0, 16]);
		// `Series 02` is no "Series 1 Bonus Bits & Bloopers" (S0E14): "Series 2 Banter Part 2"
		expect(await placedAt('QI - s00e14 - Series 02 - Banter (Part 2)')).toEqual([0, 13]);
	});
});

describe('a title TMDB spells otherwise', () => {
	// zurg on fun (2026-11-10): files placement left unplaced, their numbers being no TMDB
	// episode's, titled as one of their season's or the next but for a spelling (see the fixtures README)
	const spelled = async (name: string, file: string) => {
		const c = spellingVariants.cases.find((c) => c.request.name.startsWith(name))!;
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true }],
			Infinity,
			recordedSources(spellingVariants.answers),
			async (list) =>
				list.map(({ name }) => (spellingVariants.answers.identify as any)?.[name] ?? null)
		);
		expect(releases[0]).toEqual(c.expect);
		const f = releases[0].files.find((f) => f.path.includes(file))!;
		return [f.season, f.episode];
	};

	it('places a file by a title spelled with figures or British spelling', async () => {
		// "Attack of the Fifty-Foot Worman"
		expect(await spelled('The Backyardigans', 'Attack of the 50 Foot Worman')).toEqual([4, 12]);
		// "Journey to the Red Center", the season after the file's
		expect(await spelled('The Crocodile Hunter', 'Journey to the Red Centre')).toEqual([4, 4]);
		// "What Does Blue Wanna Do On a Rainy Day?"
		expect(await spelled("Blue's Clues", 'Want to Do on a Rainy Day')).toEqual([2, 12]);
	});

	it('places a file by a title one word of which is mistyped', async () => {
		// "The Unbelievable Wrongness of Talking"
		expect(await spelled('Becker (1998)', 'Unbearable Wrongness of Talking')).toEqual([6, 6]);
		// "Genie Meanie Minie Moe"
		expect(await spelled('The Fairly OddParents', 'Genie Meanie Minie Mo')).toEqual([4, 20]);
	});

	it('takes no number for a slip, no short title, and no title two episodes are alike', () => {
		const list = (...names: string[]) => names.map((name) => ({ name }));
		expect(spelledAlike('Treehouse of Horror V', list('Treehouse of Horror VI'))).toBeNull();
		expect(spelledAlike('Showdown Part 2', list('Showdown Part 1'))).toBeNull();
		expect(spelledAlike('Mo', list('Moe'))).toBeNull();
		expect(spelledAlike('Bart the Genius', list('Bart the General'))).toBeNull();
		expect(
			spelledAlike(
				'Genie Meanie Minie Mo',
				list('Genie Meanie Minie Moe', 'Genie Meanie Minie Mob')
			)
		).toBeNull();
	});
});

describe("a file of another show in a show's release", () => {
	// zurg on fun (2026-11-10): packs placed whole on one show, holding files of another, which DMM
	// left unplaced (see the fixtures README)
	const placed = async (name: string, shows = true) => {
		const c = otherShows.cases.find((c) => c.request.name.startsWith(name))!;
		const from = recordedSources(otherShows.answers);
		const { releases } = await place(
			[{ ...(c.request as PlaceRequest), parts: true, ...(shows ? { shows: true } : {}) }],
			Infinity,
			from,
			async (list) =>
				list.map(({ name }) => (otherShows.answers as any).identify?.[name] ?? null)
		);
		if (shows) expect(releases[0]).toEqual(c.expect);
		const answer = await titled(releases[0], from);
		return (part: string) => {
			const f = answer.files.find((f) => f.path.includes(part))!;
			return [
				f.kind ?? null,
				f.tmdbId ?? answer.tmdbId,
				f.season,
				f.episode,
				f.title ?? null,
			];
		};
	};

	it('answers a file named as another show as its episode', async () => {
		// a Batman: The Animated Series (2098) pack; "Holiday Knights" is The New Batman Adventures' S1E1
		const pack = await placed('BATMAN The Animated Series (1992-1999)');
		expect(pack('Holiday Knights')).toEqual(['tv', 4625, 1, 1, 'The New Batman Adventures']);
		expect(pack('Heart of Ice')).toEqual([null, 2098, 1, 3, null]);
	});

	it('answers a file of the show the id sent named, which most of the pack is not', async () => {
		// the pack is placed on The New Batman Adventures; "Sideshow" is Batman: The Animated Series' S2E7
		const pack = await placed('Batman TAS Seasons 2-3');
		expect(pack('066 - Sideshow')).toEqual(['tv', 2098, 2, 7, 'Batman: The Animated Series']);
		expect(pack('086 - Holiday Knights')).toEqual([null, 4625, 1, 1, null]);
	});

	it("answers a season TVDB numbers on and TMDB keeps as a revival as the revival's", async () => {
		// TMDB's 2013 Whose Line Is It Anyway? (64978), numbered as TVDB's series 76808 numbers it
		const pack = await placed('Whose Line Is It Anyway (US)');
		expect(pack('S09E01 - Lauren Cohan')).toEqual([
			'tv',
			64978,
			9,
			1,
			'Whose Line Is It Anyway?',
		]);
		expect(pack('S08E01')).toEqual([null, 61018, 8, 1, null]);
	});

	it('leaves such a file unplaced for a caller that does not read it', async () => {
		const pack = await placed('BATMAN The Animated Series (1992-1999)', false);
		expect(pack('Holiday Knights')).toEqual([null, 2098, null, null, null]);
	});
});
