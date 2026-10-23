import { buildFranchiseIndex } from '@/services/anime/animeFranchise';
import type { FribbAnimeEntry } from '@/services/anime/animeMapping';
import { getMetadataCache } from '@/services/metadataCache';
import {
	cachedSources,
	placeReleases,
	type Identify,
	type PlaceRequest,
	type PlacementSources,
} from '@/services/placement';
import answers from '@/test/fixtures/placement/answers.json';
import firefly from '@/test/fixtures/placement/firefly-1437.json';
import imdbSeries from '@/test/fixtures/placement/imdb-series.json';
import cases from '@/test/fixtures/placement/releases.json';
import fun1022 from '@/test/fixtures/placement/rex-fun-2026-10-22.json';
import fun1023 from '@/test/fixtures/placement/rex-fun-2026-10-23.json';
import siblingShows from '@/test/fixtures/placement/sibling-shows.json';
import titleChecks from '@/test/fixtures/placement/title-checks.json';
import liveFind from '@/test/fixtures/placement/tmdb-find-tt14986406.json';
import { buildAnimeIndex } from '@/utils/episodePlacement';
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
	imdbSeries: async (id) => r.imdbSeries?.[id] ?? null,
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

	it("places a pack's files by their titles on IMDb's seasons, never by TFS's running count", async () => {
		const pack = await placedHere('[iKaos] TFS Dragon Ball Z Abridged Collection');
		expect(pack).toMatchObject({ kind: 'tv', imdbId: 'tt10710138', tmdbId: null });
		expect(at(pack, '025 - Nail Is Piccolo')).toEqual([2, 15, 'imdb']);
		expect(at(pack, '055 - It')).toEqual([3, 25, 'imdb']);
		// a side series' number and a deleted scene's are no episodes of the show
		expect(at(pack, 'DragonShortZ - 001')).toEqual([null, null, null]);
		expect(at(pack, '001 - Deleted Scene Episode 3')).toEqual([null, null, null]);
		const series = await placedHere('TFS Dragon Ball Z Abridged - Complete');
		// TFS's `Episode 11` is IMDb's S2E1, so no `Episode N` is placed by its number
		expect(series.files.every((f) => f.season === null)).toBe(true);
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
		expect(releases[0].files.find((f) => f.episode !== null)).toMatchObject({
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
});
