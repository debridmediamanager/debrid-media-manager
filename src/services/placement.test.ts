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
import cases from '@/test/fixtures/placement/releases.json';
import fun1022 from '@/test/fixtures/placement/rex-fun-2026-10-22.json';
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

	it('answers a release it looked at and could not identify with the id sent, so it never reads as skipped', async () => {
		// zurg pushed tt10710138, which TMDB's find knows nothing by, and the identifier names nothing
		const abridged = named('[iKaos] TFS Dragon Ball Z Abridged');
		expect(recorded.find[abridged.request.imdbId!]).toEqual({
			movie_results: [],
			tv_results: [],
			tv_episode_results: [],
		});
		const { releases, complete } = await place([abridged.request as PlaceRequest]);
		expect(complete).toBe(true);
		expect(releases[0]).toMatchObject({ kind: null, imdbId: 'tt10710138', tmdbId: null });
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
		// `Batman - 086 - Holiday Knights` spells the 1966 Batman: an unsure answer never overrides an id
		['Batman TAS Seasons 2-3', 2098],
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
});
