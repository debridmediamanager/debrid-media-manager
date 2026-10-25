import debridLinkSeedbox from '@/test/fixtures/debridlink/seedbox-list-2026-09-06.json';
import packs from '@/test/fixtures/placement/pack-folders.json';
import releases from '@/test/fixtures/placement/releases.json';
import hard from '@/test/fixtures/placement/unplaced-episodes.json';
import frierenAddons from '@/test/fixtures/seasonEpisodes/addons-tt22248376-s1.json';
import { fileNumbers, normalizeTitle, parseName, titleText } from '@/utils/episodePlacement';
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
				// a director's cut, which TMDB lists as no episode of its own
				"/[Sephirotic] Evangelion - 22' [MULTI][BD 1080p 8bits 5.1 AAC][82842B04].mkv: null for 1,22",
			],
		});
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

describe('parseName', () => {
	it('keeps a short word the title joins with a hyphen, which the parser reads as a language', () => {
		const motto = release('[KH] Motto To Love-Ru');
		expect(parseName(motto.name).title).toBe('Motto To Love-Ru');
		expect(parseName(motto.files.at(-1)!.path).title).toBe('Motto To Love-Ru');
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
		// Latin-1 that is no UTF-8 stays as it is
		expect(titleText(' Pokémon Fan Club.mkv')?.whole).toBe('pokémon fan club');
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
