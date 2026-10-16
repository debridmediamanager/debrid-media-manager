import packs from '@/test/fixtures/placement/pack-folders.json';
import hard from '@/test/fixtures/placement/unplaced-episodes.json';
import { fileNumbers, normalizeTitle, titleText } from '@/utils/episodePlacement';
import { describe, expect, it } from 'vitest';

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
});
