import {
	isOnePace,
	ONE_PACE_WATCH,
	onePaceCatalogue,
	parseWatchFlight,
	placeOnePace,
	refreshOnePace,
	resetOnePaceForTests,
} from '@/services/onePace';
import snapshot from '@/services/onePaceCatalogue.json';
import type { PlacedRelease, PlaceRequest } from '@/services/placement';
import fun from '@/test/fixtures/onepace/fun-releases-2026-11-09.json';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gunzipSync } from 'zlib';

/**
 * onepace.net/en/watch's flight as `RSC: 1` fetched it on 2026-11-09 (what `refreshOnePace`
 * reads), and every One Pace release fun's RD zurg held that day, as zurg asks about it.
 */
const flight = gunzipSync(
	readFileSync(join(__dirname, '../test/fixtures/onepace/watch-2026-11-09.rsc.gz'))
).toString('utf8');
const catalogue = parseWatchFlight(flight)!;
const releases = fun.releases as PlaceRequest[];

/** `S16E08` for a file its answer numbers, null for one it leaves unplaced. */
const numbered = (answer: PlacedRelease) =>
	Object.fromEntries(
		answer.files.map((file) => [
			file.path,
			file.series
				? `S${String(file.series.season).padStart(2, '0')}E${String(file.series.episode).padStart(2, '0')}`
				: null,
		])
	);
const all = () => Object.assign({}, ...releases.map((r) => numbered(placeOnePace(r, catalogue))));

describe("One Pace's list", () => {
	it('is read off the watch page as the checked-in snapshot holds it', () => {
		// WRITE_ONEPACE_SNAPSHOT=1 npx vitest run src/services/onePace.test.ts writes it again
		if (process.env.WRITE_ONEPACE_SNAPSHOT) {
			writeFileSync(
				join(__dirname, 'onePaceCatalogue.json'),
				JSON.stringify(catalogue, null, '\t') + '\n'
			);
		}
		expect(catalogue).toEqual(snapshot);
	});

	it("numbers main arcs in One Pace's order and its cover stories and specials as season 0", () => {
		const seasons = catalogue.arcs.map((arc) => [arc.season, arc.title, arc.episodes.length]);
		expect(seasons.filter(([season]) => season !== 0)).toHaveLength(33);
		expect(seasons.slice(0, 8)).toEqual([
			[1, 'Romance Dawn', 4],
			[2, 'Orange Town', 3],
			[3, 'Syrup Village', 7],
			[4, 'Gaimon', 1],
			[5, 'Baratie', 8],
			[6, 'Arlong Park', 10],
			[0, "The Adventures of Buggy's Crew", 1],
			// Loguetown 01.5, from the novel, covers no chapter and is left out
			[7, 'Loguetown', 3],
		]);
		expect(seasons.filter(([season]) => season === 0)).toEqual([
			[0, "The Adventures of Buggy's Crew", 1],
			[0, 'The Trials of Koby-Meppo', 1],
			[0, 'If You Could Go Anywhere... The Adventures of the Straw Hats', 1],
			[0, 'One Piece Fan Letter', 1],
			[0, 'Warship Island 01 (April Fools 2025)', 1],
		]);
		expect(
			catalogue.arcs.filter((arc) => arc.season === 0).map((arc) => arc.episodes[0].episode)
		).toEqual([1, 2, 3, 4, 5]);
		expect(seasons.at(-3)).toEqual([33, 'Egghead', 22]);
		const water = catalogue.arcs.find((arc) => arc.slug === 'water-seven')!;
		expect(water.season).toBe(16);
		expect(water.poster).toMatch(/^https:\/\/onepace\.net\/_next\/static\/media\//);
		expect(water.episodes[7]).toMatchObject({
			number: 8,
			episode: 8,
			chapters: [[340, 342]],
			thumb: expect.stringMatching(/^https:\/\/onepace\.net\/_next\/static\/media\//),
		});
		expect(water.episodes[7].title).not.toBe('');
		expect(water.episodes[7].summary).not.toBe('');
		// a range the flight sent once and refers back to: Gaimon's 42 and 22
		expect(catalogue.arcs.find((arc) => arc.slug === 'gaimon')!.episodes[0].chapters).toEqual([
			[42, 42],
			[22, 22],
		]);
		expect(catalogue.summary).toMatch(
			/^One Pace is a fan project that recuts the One Piece anime/
		);
	});

	it('is refused where the page holds no list DMM can read', () => {
		expect(parseWatchFlight('')).toBeNull();
		expect(parseWatchFlight('<html>maintenance</html>')).toBeNull();
		// a page listing a few arcs is a page DMM misreads, not One Pace's list
		const [, first] = /^[0-9a-f]+:(.*"timeline":\{"segments".*)$/m.exec(flight)!;
		const element = JSON.parse(first);
		element[3].data.timeline.segments = element[3].data.timeline.segments.slice(0, 5);
		expect(parseWatchFlight(`c:${JSON.stringify(element)}`)).toBeNull();
	});
});

describe("fun's One Pace releases", () => {
	it('are One Pace by their tag', () => {
		expect(releases.every(isOnePace)).toBe(true);
		expect(
			isOnePace({ name: 'One.Piece.S01E01.1080p', hash: null, imdbId: null, files: [] })
		).toBe(false);
	});

	it('place each file whose chapters, arc and number name one of its episodes', () => {
		const placed = all();
		expect(Object.keys(placed)).toHaveLength(464);
		expect(Object.values(placed).filter(Boolean)).toHaveLength(430);
		expect(placed).toMatchObject({
			'[One Pace][340-342] Water Seven 08 [1080p][6E2DB1B9].mkv': 'S16E08',
			'[One Pace][1] Romance Dawn 01 [1080p][FB72C13F].mkv': 'S01E01',
			'[One Pace][69-71] Arlong Park 01 [480p][D8004901].mkv': 'S06E01',
			// One Pace spelled Alabasta `Arabasta` in its older names
			'[One Pace][179-182] Arabasta 10 [1080p][4B8CC4E7].mkv': 'S12E10',
			'[One Pace][159, 161-162] Arabasta 03 [1080p][73003149].mkv': 'S12E03',
			// its chapters in either order, with or without its number
			'[One Pace][22,42] Gaimon 01 [1080p][9AA8B637].mkv': 'S04E01',
			'[One Pace][42,22] Gaimon [480p][EFF6059A].mkv': 'S04E01',
			'[One Pace][1079] Egghead 13 Extended [1080p][88019227].mkv': 'S33E13',
			// Dressrosa's files name no arc: the release's name does
			'[One Pace] Chapter 700-701 [720p][2A35B710].mkv': 'S28E01',
			'[One Pace] Chapter 798-800 [720p][5F035A13].mkv': 'S28E48',
			// cover stories are specials
			"[One Pace][35-75] The Adventures of Buggy's Crew [1080p][E75794DB].mkv": 'S00E01',
			'[One Pace][83-119] The Trials of Koby-Meppo [1080p][4B56844F].mkv': 'S00E02',
			'[One Pace][543-560] If You Could Go Anywhere... The Adventures of the Straw Hats [1080p][2BC41092].mkv':
				'S00E03',
			// in a release of One Pace's specials
			'[One Pace][823-824] Whole Cake Island 01 [720p][EDB72EE5].mp4': 'S30E01',
		});
	});

	it('place a file of an older cut on the episode it became', () => {
		expect(all()).toMatchObject({
			// the same chapters under another number: One Pace made one of Baratie's old 03 and 04
			'[One Pace][53-55] Baratie 05 [1080p][6858E16A].mkv': 'S05E04',
			'[One Pace][67-68] Baratie 09 [1080p][D8C1FD62].mkv': 'S05E08',
			'[One Pace][436-437] Post-Enies Lobby 03 [720p][2C843A0F].mkv': 'S18E04',
			'[One Pace][40-41] Syrup Village 06 [480p][D1742A98].mkv': 'S03E07',
			// its number, a chapter more or less: Drum Island 04 is 139-141 now, Wano 24 944-945
			'[One Pace][139-140] Drum Island 04 [1080p][902076E8].mkv': 'S11E04',
			'[One Pace][153-155, 142] Drum Island 08 [1080p][9794072D].mkv': 'S11E08',
			'[One Pace][189-192] Arabasta 13 [1080p][58649840].mkv': 'S12E13',
			'[One Pace][945] Wano 24 [1080p][6173BCE1].mkv': 'S32E24',
			'[One Pace][101-103] Reverse Mountain 01 [1080p][CE01A533].mkv': 'S08E01',
		});
	});

	it('leave a file of an older cut, or none of the list, unplaced', () => {
		expect(all()).toMatchObject({
			// re-edited onto other chapters: One Pace's Baratie 03 is 48-52 now, the old 04 a part of it
			'[One Pace][47-49] Baratie 03 [1080p][0EB7F7E9].mkv': null,
			'[One Pace][50-52] Baratie 04 [1080p][15D77CB3].mkv': null,
			// two of today's episodes: Loguetown 02 is 98-99 and 03 100, Post-Enies Lobby 03 435
			'[One Pace][98-100] Loguetown 03 [480p][23E3E489].mkv': null,
			'[One Pace][433-435] Post-Enies Lobby 02 [720p][344EA844].mkv': null,
			'[One Pace][35-39] Syrup Village 05 [480p][5498C538].mkv': null,
			// no chapters in the name
			'[One Pace] Paced One Piece - Thriller Bark Episode 01 [720p][30D0916C].mkv': null,
			'[One Pace][Romance Dawn v2] Romance Dawn v2 [1080p][5E77445F].mkv': null,
			'[One Pace] Straw Hat Theatre [720p][415455AE].mkv': null,
			'[One Pace][0] Strong World [480p][76B2C869].mkv': null,
			"[One Pace][236-262 Covers] Wapol's Omnivorous Hurrah [720p][05BE81E6].mkv": null,
			'[One Pace] Tournament of Power.mp4': null,
		});
	});

	it('answer the show and its episodes beside what an older caller reads as unplaced', () => {
		const water = releases.find((r) =>
			r.name.startsWith('[One Pace][340-342] Water Seven 08')
		)!;
		const answer = placeOnePace(water, catalogue);
		const arc = catalogue.arcs.find((a) => a.season === 16)!;
		const episode = arc.episodes[7];
		expect(answer).toEqual({
			kind: null,
			imdbId: null,
			tmdbId: null,
			anime: true,
			series: {
				key: 'onepace',
				title: 'One Pace',
				summary: catalogue.summary,
				poster: catalogue.arcs[0].poster,
				art: catalogue.arcs[0].poster,
				seasons: [
					{ season: 16, title: 'Water Seven', summary: arc.summary, poster: arc.poster },
				],
			},
			files: [
				{
					path: water.files[0].path,
					season: null,
					episode: null,
					episodeEnd: null,
					how: null,
					tmdbEpisodeId: null,
					series: {
						season: 16,
						episode: 8,
						title: episode.title,
						summary: episode.summary,
						thumb: episode.thumb,
					},
				},
			],
		});
	});

	it('answer a release whose files the list numbers none of as one DMM cannot place', () => {
		for (const name of [
			'[One Pace] Tournament of Power.mp4',
			'[One Pace] Paced One Piece - Thriller Bark [720p]',
		]) {
			const answer = placeOnePace(
				releases.find((r) => r.name === name)!,
				catalogue
			);
			expect(answer.series).toBeUndefined();
			expect(answer.anime).toBeUndefined();
			expect(answer.kind).toBeNull();
			expect(answer.files.every((f) => f.season === null && !f.series)).toBe(true);
		}
	});
});

describe("keeping One Pace's list current", () => {
	afterEach(async () => {
		await resetOnePaceForTests();
		vi.useRealTimers();
	});

	const page = (body: string, status = 200) =>
		vi.fn(async (..._: Parameters<typeof fetch>) => new Response(body, { status }));

	it('answers the snapshot at once and fetches the page once a day, in the background', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-10T00:00:00Z'));
		const fetcher = page(
			flight.replace('One Pace is a fan project', 'Fetched: One Pace is a fan project')
		);
		expect(onePaceCatalogue(fetcher)).toBe(snapshot);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(fetcher.mock.calls[0][0]).toBe(ONE_PACE_WATCH);
		expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { RSC: '1' } });
		// the request waited on nothing; the list it fetched is taken once it arrives
		await resetOnePaceForTests();
	});

	it('takes a fetched list, and keeps it until a day has passed', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-10T00:00:00Z'));
		const fetcher = page(
			flight.replace('One Pace is a fan project', 'Fetched: One Pace is a fan project')
		);
		await refreshOnePace(fetcher);
		const fetched = onePaceCatalogue(fetcher);
		expect(fetched.summary).toMatch(/^Fetched: /);
		vi.setSystemTime(new Date('2026-11-10T23:00:00Z'));
		expect(onePaceCatalogue(fetcher)).toBe(fetched);
		expect(fetcher).toHaveBeenCalledTimes(1);
		vi.setSystemTime(new Date('2026-11-11T00:00:01Z'));
		onePaceCatalogue(fetcher);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('keeps the list it has when the page fails or holds none, and tries again an hour on', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-10T00:00:00Z'));
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		await refreshOnePace(page('', 500));
		await refreshOnePace(page('<html>maintenance</html>'));
		expect(error).toHaveBeenCalledTimes(2);
		const broken = page('', 500);
		expect(onePaceCatalogue(broken)).toBe(snapshot);
		expect(broken).not.toHaveBeenCalled();
		vi.setSystemTime(new Date('2026-11-10T01:00:01Z'));
		expect(onePaceCatalogue(broken)).toBe(snapshot);
		expect(broken).toHaveBeenCalledTimes(1);
		await resetOnePaceForTests();
		error.mockRestore();
	});
});
