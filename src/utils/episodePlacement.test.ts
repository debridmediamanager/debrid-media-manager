import debridLinkSeedbox from '@/test/fixtures/debridlink/seedbox-list-2026-09-06.json';
import bracketed from '@/test/fixtures/placement/bracketed-titles.json';
import funNumbers from '@/test/fixtures/placement/fun-numbers-2026-11-09.json';
import lost from '@/test/fixtures/placement/lost-tvdb-order.json';
import packs from '@/test/fixtures/placement/pack-folders.json';
import releases from '@/test/fixtures/placement/releases.json';
import saga from '@/test/fixtures/placement/saga-titles.json';
import hard from '@/test/fixtures/placement/unplaced-episodes.json';
import frierenAddons from '@/test/fixtures/seasonEpisodes/addons-tt22248376-s1.json';
import hashlistNames from '@/test/fixtures/seasonNaming/hashlist-names-2026-11-11.json';
import {
	airDates,
	alignTvdb,
	fileNumbers,
	normalizeTitle,
	parseName,
	releaseSeasons,
	stackedParts,
	titleText,
	type ListedEpisode,
} from '@/utils/episodePlacement';
import { namedSeasons } from '@/utils/seasonNaming';
import { describe, expect, it } from 'vitest';

const release = (name: string) => releases.find((c) => c.request.name.startsWith(name))!.request;

type Case = {
	release: string;
	folder?: string;
	file: string;
	season: number | null;
	episode: number | null;
};

/** The numbers each file reads as against the numbers read off it by hand, (season, episode) or null. */
function misread(files: Case[]) {
	const wrong: string[] = [];
	const unread: string[] = [];
	for (const c of files) {
		const got = fileNumbers(c.release, c.folder ?? null, c.file, false);
		const want = c.episode === null ? null : [c.season ?? 1, c.episode];
		const read = got && [got.season ?? 1, got.episode];
		if (JSON.stringify(read) === JSON.stringify(want)) continue;
		(read ? wrong : unread).push(`${c.folder ?? ''}/${c.file}: ${read} for ${want}`);
	}
	return { wrong, unread };
}

describe('fileNumbers', () => {
	// Every video file of eight multi-season packs on fun's providers (rex's corpus, numbers
	// read by hand): `Stagione 6/01 Zod`, `Season 6/601 - …`, `S1 (2007-9)/101a-b - …`, and the
	// `Extra` folders that hold no episodes.
	it('reads every file of eight real packs as their season folders number them', () => {
		expect(misread((packs as { files: Case[] }).files)).toEqual({ wrong: [], unread: [] });
	});

	// The shapes rex's production feed left unplaced or misplaced (2026-10-13..16): fansub
	// seasons (`Tower of God S2 - 07v2`, `2nd Season - 14`), a group named `[0x539]`, frame
	// sizes, scene shorthand (`aaf-wilty.302` in `…S03E01`), year seasons, a Japanese season
	// numeral, a title then its number, and extras.
	it('reads the shapes rex left unplaced, and misreads none', () => {
		expect(misread((hard as { files: Case[] }).files)).toEqual({
			wrong: [],
			unread: [
				// a release of one file named by its hash: zurg sends that release alone
				'/0816e0b1bd854e41b9aaa223db7a413b.mkv: null for 4,21',
			],
		});
	});

	it('reads a bracketed episode number before a title with a special word in it', () => {
		// zurg on fun (2026-11-10), `My Hero Academia`'s `Season 3`: TMDB's S3E20 "Special Episode:
		// Save the World with Love!", the 58th, was left unnumbered as a special
		expect(
			fileNumbers(
				'My Hero Academia',
				'Season 3',
				'[Episode 58] Special Episode：Save the World with Love!.mkv',
				false
			)
		).toMatchObject({ season: 3, episode: 58 });
		// a special named before the number stays unnumbered
		expect(
			fileNumbers('My Hero Academia', 'Season 3', 'Special [Episode 58].mkv', false)
		).toBeNull();
	});

	it('takes a lone file its release numbers', () => {
		expect(
			fileNumbers(
				'[Erai-raws].Kingdom.4th.Season-21.[1080p]',
				'',
				'0816e0b1bd854e41b9aaa223db7a413b.mkv',
				true
			)
		).toMatchObject({ season: 4, episode: 21 });
	});

	it('keeps the first episode a name gives and ends a multi-episode file on the last', () => {
		expect(
			fileNumbers(
				'Family Guy - Seasons 1 to 20',
				'Season 11',
				'Family Guy - S11E16 - 12 and a Half Angry Men (Uncensored).mkv',
				false
			)
		).toMatchObject({ season: 11, episode: 16, end: null });
		expect(
			fileNumbers(
				'The.Amazing.World.of.Gumball.S04',
				'',
				'The.Amazing.World.of.Gumball.S04E17E18.The.Hug.The.Wicked.mkv',
				false
			)
		).toMatchObject({ season: 4, episode: 17, end: 18 });
	});
	it("reads `S11E01 - 286` as one episode and the show's running number, never episodes 1 to 286", () => {
		const vf = release('Détective.Conan.-.Inédits.VF');
		expect(vf.files.map((f) => fileNumbers(vf.name, f.folder, f.path, false))).toEqual([
			{ season: 11, episode: 1, end: null, running: 286 },
			{ season: 11, episode: 2, end: null, running: 287 },
			{ season: 11, episode: 3, end: null, running: 288 },
		]);
	});
});

describe('airDates', () => {
	// Real names from DMM's library (ScrapedTrue, 2026-10-29) of daily shows
	it('reads the day a daily show aired, in the shapes its releases write it', () => {
		expect(airDates('WWE.RAW.2026.10.05.NF.DEF.1080p.WEB.h265-HEEL')).toEqual(['2026-10-05']);
		expect(airDates('WWE Monday Night RAW 2026 10 12 1080p HDTV H264-Star [TJET]')).toEqual([
			'2026-10-12',
		]);
		expect(
			airDates('The.Daily.Show.2025.03.31.Oren.Cass.1080p.WEB.h264-EDITH[EZTVx.to]')
		).toEqual(['2025-03-31']);
		expect(
			airDates('Saturday Night Live 2018 12.04 A Saturday Night Live Christmas Special 1080p')
		).toEqual(['2018-12-04']);
		// day and month before the year: either way round where both could be
		expect(airDates('WWE Monday Night Raw 14 07 2025 1080p WEBDL H264 Ita Ac3 2 0 Co')).toEqual(
			['2025-07-14']
		);
		expect(airDates('WWE Raw 05.10.2026 [2026, Рестлинг, WEB-DL1080p60fps, MKVH.265]')).toEqual(
			['2026-10-05', '2026-05-10']
		);
	});

	it('reads no day from a year alone, a resolution or a date no calendar has', () => {
		expect(airDates('Kitchen.Nightmares.2023.S02E03.Voleos.1080p.AMZN.WEB-DL')).toEqual([]);
		expect(airDates('Show.2026.02.30.1080p.WEB.h264')).toEqual([]);
	});

	it('leaves the numbers beside an air date unread', () => {
		// 1080 was read as the episode, counted through the show's seasons
		const name = 'RAW 2026.09.14 1080 (DTvW).mp4';
		expect(fileNumbers(name, '', name, true)).toBeNull();
		// nor 14, a day, read as the episode after the show's name
		const italian = 'WWE Monday Night Raw 14 07 2025 1080p WEBDL H264 Ita Ac3 2 0 Co';
		expect(fileNumbers(italian, '', `${italian}.mkv`, true)).toBeNull();
		// an episode named as well is still that episode
		const both = 'WWE Monday Night Raw S34E31 Netflix 2026-08-03 1080p AVCHD-SC-SDH.mp4';
		expect(fileNumbers(both, '', both, true)).toMatchObject({ season: 34, episode: 31 });
	});
});

describe("fileNumbers on files fun's zurg held unplaced on 2026-11-09", () => {
	// numbers read by hand from each name (see the fixtures README)
	it.each(funNumbers.files.map((c) => [`${c.shape}: ${c.release} / ${c.file}`, c] as const))(
		'%s',
		(_, c) => {
			const got = fileNumbers(c.release, c.folder, c.file, Boolean((c as any).single));
			expect(got && [got.season, got.episode]).toEqual([c.season, c.episode]);
			// a file of several episodes, its last
			if ('end' in c) expect(got?.end).toBe(c.end);
		}
	);
});

describe('parseName', () => {
	it('keeps a short word the title joins with a hyphen, which the parser reads as a language', () => {
		const motto = release('[KH] Motto To Love-Ru');
		expect(parseName(motto.name).title).toBe('Motto To Love-Ru');
		expect(parseName(motto.files.at(-1)!.path).title).toBe('Motto To Love-Ru');
	});

	it('keeps Saga in a title, which the parser reads as a collection', () => {
		// zurg on fun, 2026-11-09: `[sam] Vinland Saga [BD 1080p FLAC]` and its files
		const { request } = saga.cases[0];
		expect(parseName(request.name).title).toBe('Vinland Saga');
		expect(parseName(request.files[0].path).title).toBe('Vinland Saga');
	});

	it("reads a name all in brackets by the one after the group's", () => {
		// zurg-usenet on fun, 2026-11-09: `[philosophy-raws][Samurai Champloo][26][BDRIP]…`
		for (const { request } of bracketed.cases) {
			expect(parseName(request.name).title).toBe('Samurai Champloo');
		}
	});

	it.each([
		// zurg-usenet on fun and DMM's PlacementMiss, 2026-11-10
		[
			'[ANi].入間同學入魔了！第四季.-.20.[1080P][Baha][WEB-DL][AAC.AVC][CHT]',
			'入間同學入魔了！',
			4,
		],
		['黑袍纠察队 第一季', '黑袍纠察队', 1],
		// numerals past nine, which no recorded name has yet
		['[ANi] 某劇 第十二季 - 01 [1080P]', '某劇', 12],
		['[ANi] 某劇 第20季 - 01 [1080P]', '某劇', 20],
	])('reads a Chinese season out of the title: %s', (name, title, season) => {
		expect(parseName(name)).toMatchObject({ title, season });
	});
});

describe('normalizeTitle', () => {
	it('keeps letters and digits of any script, words split on everything else', () => {
		expect(normalizeTitle('Hibike! Euphonium 3')).toBe('hibike euphonium 3');
		expect(normalizeTitle('Gintama°: Aizome Kaori-hen')).toBe('gintama aizome kaori hen');
	});
});

describe('titleText', () => {
	// what follows the episode token of real files, from rex-fun's library and the zen rig
	it('reads the title up to where the release tags begin, or nothing when only tags follow', () => {
		expect(titleText('.Serenity.1080p.BRRip.AC3.x264-LESS.mkv')?.whole).toBe('serenity');
		// `Bricks` is no BRRip
		expect(titleText('.Barrel.of.Bricks.1080p.Rus.Eng.mkv')?.whole).toBe('barrel of bricks');
		expect(titleText(' - The End of Time (2) (480p x265 EDGE2020).mkv')?.whole).toBe(
			'the end of time 2'
		);
		expect(titleText(' - One of Us; Vanishing Act.mkv')).toEqual({
			whole: 'one of us vanishing act',
			first: 'one of us',
		});
		expect(titleText('.1080p.BluRay.REMUX.AVC.DD.5.1-NOGRP.mkv')).toBeNull();
		expect(titleText(' END (2160p).mp4')).toBeNull();
	});
	it('reads a title written as UTF-8 and read as Latin-1 as written', () => {
		// zurg-usenet's `Fruits Basket S01E24 Letâ\u0080\u0099s Go Home.mkv` (2026-10-25), whose release
		// name `…LetÃ¢Â\u0080Â\u0099s Go Home` was read so twice; TMDB's S1E24 is "Let's Go Home"
		expect(titleText(' Letâ\u0080\u0099s Go Home.mkv')?.whole).toBe('lets go home');
		expect(titleText(' LetÃ¢Â\u0080Â\u0099s Go Home')?.whole).toBe('lets go home');
		expect(titleText(' You Look Wellâ\u0080¦.mkv')?.whole).toBe('you look well');
		// Latin-1 that is no UTF-8 stays as it is, its accent aside
		expect(titleText(' Pokémon Fan Club.mkv')?.whole).toBe('pokemon fan club');
	});
});

// zurg#281: moviesbyrizzo's Seinfeld complete series names its files `Seinfeld  (S01EP02)  The
// Stake Out …` and a double episode `(S09EP23) plus EP24 The Finale`. The request is the release
// as zurg sent it on 2026-10-22; DMM's answer then placed none of them by their own numbers.
describe('a season and episode in brackets as SxxEPyy', () => {
	it('reads every Seinfeld file as the episode it names', async () => {
		const { request } = (await import('@/test/fixtures/placement/seinfeld-sxxepyy.json'))
			.default;
		expect(request.files).toHaveLength(171);
		const wrong: string[] = [];
		for (const file of request.files) {
			const m = /\(S(\d\d)EP(\d\d)\)(?: plus EP(\d\d))?/.exec(file.path)!;
			const want = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null];
			const got = fileNumbers(request.name, file.folder, file.path, false);
			const read = got && [got.season, got.episode, got.end];
			if (JSON.stringify(read) !== JSON.stringify(want))
				wrong.push(`${file.path}: ${read} for ${want}`);
		}
		expect(wrong).toEqual([]);
	});
});

// A lockfile refresh in f9818bba moved ptt from the pinned branch to upstream master,
// which reads `BS4` (a broadcaster) and `DS4K` (a downscale tag) as a season: Frieren's
// episodes went looking for a fourth season and Se7en became a show.
describe('parseName on real names a ptt upgrade misread', () => {
	const names = [
		...JSON.stringify(debridLinkSeedbox).matchAll(/"([^"/]*DS4K[^"]*\.mkv)"/g),
		...JSON.stringify(frierenAddons).matchAll(
			/"(\[YE\] Sousou no Frieren - \d+ \(BS4[^"]*\.mkv)"/g
		),
	].map((m) => JSON.parse(`"${m[1]}"`) as string);

	it('reads them from the fixtures', () => {
		expect(names.some((n) => n.includes('DS4K'))).toBe(true);
		expect(names.some((n) => n.includes('BS4'))).toBe(true);
	});

	it.each(names)('names no season in %s', (name) => {
		expect(parseName(name).season).toBeNull();
	});
});

describe('alignTvdb', () => {
	// TVDB's and TMDB's own lists of Lost (TheTVDB 73739, TMDB 4607), 2026-11-01
	const tvdb = (order: '73739' | '73739/dvd'): ListedEpisode[] =>
		lost.answers.tvdbEpisodes[order].data.episodes.map((row) => ({
			season: row.seasonNumber,
			episode: row.number,
			airDate: row.aired,
			name: row.name,
			runtime: row.runtime,
		}));
	const tmdb: ListedEpisode[] = Object.values(lost.answers.season).flatMap((list) =>
		list.episodes.map((row) => ({
			season: row.season_number,
			episode: row.episode_number,
			airDate: row.air_date,
			name: row.name,
			runtime: row.runtime,
		}))
	);
	const part = (season: number, episode: number, part: number) => ({
		season,
		episode,
		episodeEnd: null,
		part,
	});

	it("maps TVDB's two halves of a finale TMDB lists as one episode, and nothing else", () => {
		expect(alignTvdb(tvdb('73739'), tmdb)).toEqual(
			new Map([
				['4|13', part(4, 13, 1)],
				['4|14', part(4, 13, 2)],
				['6|17', part(6, 17, 1)],
				['6|18', part(6, 17, 2)],
			])
		);
	});

	it('maps TVDB\'s DVD order of season 1, which splits "Exodus (2)" in two', () => {
		const dvd = alignTvdb(tvdb('73739/dvd'), tmdb);
		expect([dvd.get('1|24'), dvd.get('1|25')]).toEqual([part(1, 24, 1), part(1, 24, 2)]);
	});

	it('maps nothing where both lists agree', () => {
		expect(alignTvdb(tmdb, tmdb).size).toBe(0);
	});
});

describe('a part a file names after its episode', () => {
	const parts = (...names: string[]) =>
		stackedParts(names.map((name) => fileNumbers('', '', name, false))).map(
			(numbers) => numbers?.part ?? null
		);

	// the Discord user's workaround for HiQVE's Lost BluRay, and Plex's own stacking words
	it('is read beside the file of that episode it is a part of', () => {
		expect(
			parts(
				'Lost.S01E24.1080p.Bluray.x265-HiQVE.mkv',
				'Lost.S01E24.Part.2.1080p.Bluray.x265-HiQVE.mkv'
			)
		).toEqual([null, 2]);
		expect(parts('Lost - S04E13 - pt1.mkv', 'Lost - S04E13 - pt2.mkv')).toEqual([1, 2]);
		expect(parts('Lost.S04E13.cd1.mkv', 'Lost.S04E13.disc2.mkv')).toEqual([1, 2]);
	});

	// rex-fun's library on 2026-11-01: every such name there is an episode's own title
	it('is no part where no other file is of that episode', () => {
		expect(
			parts(
				'Greys.Anatomy.S05E01.Part1.1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1-NOGRP.mkv',
				'Greys.Anatomy.S05E02.Part2.1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1-NOGRP.mkv'
			)
		).toEqual([null, null]);
		expect(
			parts(
				'Twin.Peaks.S03E01.Part.1.1080p.TrueHD.5.1.AVC.REMUX-FraMeSToR.mkv',
				'Twin.Peaks.S03E02.Part.2.1080p.TrueHD.5.1.AVC.REMUX-FraMeSToR.mkv'
			)
		).toEqual([null, null]);
	});

	it('is never a title after the episode', () => {
		const name =
			'Friends.S06E24.The.One.with.the.Proposal.Part.1.1080p.BluRay.REMUX.AVC.DD.5.1-NOGRP.mkv';
		expect(fileNumbers('', '', name, false)).toEqual({ season: 6, episode: 24, end: null });
	});
});

describe('releaseSeasons', () => {
	it.each(hashlistNames.cases)('$name holds seasons $seasons', ({ name, seasons }) => {
		expect(releaseSeasons(name)).toEqual(seasons);
	});

	it('reads a fansub season alone, where namedSeasons reads a range', () => {
		const name = '[SubsPlease] Tower of God S2 - 01 (1080p) [D0A6D666].mkv';
		expect(releaseSeasons(name)).toEqual([2]);
		expect(releaseSeasons('[SubsPlease] Honzuki no Gekokujou S3 - 23 (1080p).mkv')).toEqual([
			3,
		]);
	});

	// the verdict job moves a release off a page namedSeasons says it does not name
	it('only files a release on a page namedSeasons agrees it names', () => {
		for (const { name } of [
			...hashlistNames.cases,
			{ name: '[SubsPlease] Honzuki no Gekokujou S3 - 23 (1080p).mkv' },
		]) {
			const named = namedSeasons(name);
			expect(releaseSeasons(name).filter((s) => !named.has(s))).toEqual([]);
		}
	});
});
