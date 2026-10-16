import { buildFranchiseIndex } from '@/services/anime/animeFranchise';
import type { FribbAnimeEntry } from '@/services/anime/animeMapping';
import {
	placeReleases,
	type Identify,
	type PlaceRequest,
	type PlacementSources,
} from '@/services/placement';
import answers from '@/test/fixtures/placement/answers.json';
import cases from '@/test/fixtures/placement/releases.json';
import { buildAnimeIndex } from '@/utils/episodePlacement';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');

/**
 * Real releases (rex-fun's library on fun, 2026-10-16, and rex's hand-read anime cases) and
 * every answer placing them needed, recorded from production: TMDB through DMM's metadata
 * API, IMDb's episodes and the `Anime` titles from dmmdb, the Fribb dataset and manami's
 * synonyms. See src/test/fixtures/placement/README.md.
 */
const recorded = answers as any;
const anime = buildAnimeIndex(
	buildFranchiseIndex(recorded.anime.fribb as FribbAnimeEntry[]),
	recorded.anime.titles
);
const sources: PlacementSources = {
	find: async (id) => recorded.find[id] ?? null,
	show: async (id) => recorded.show[id] ?? null,
	season: async (id, n) => recorded.season[`${id}/${n}`] ?? null,
	episodeShow: async (id) => recorded.episodeShow[id] ?? null,
	seasonEpisodes: async (show, n) =>
		new Map(
			Object.entries(recorded.seasonEpisodes[`${show}/${n}`] ?? {}).map(([e, t]) => [
				Number(e),
				t as string,
			])
		),
	anime: async () => anime,
};
const identify: Identify = async (list) => list.map(({ name }) => recorded.identify[name] ?? null);
const place = (requests: PlaceRequest[], deadline = Infinity, from = sources, ask = identify) =>
	placeReleases(requests, ask, from, deadline);

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
