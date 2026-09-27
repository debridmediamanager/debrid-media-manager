import names from '@/test/fixtures/anime/anime-release-names.json';
import dou from '@/test/fixtures/anime/scrapedtrue-anime-anidb-17052.json';
import frieren from '@/test/fixtures/anime/scrapedtrue-anime-anidb-17617.json';
import bookworm4 from '@/test/fixtures/anime/scrapedtrue-anime-anidb-18302.json';
import { describe, expect, it } from 'vitest';
import {
	matchesAnimeEpisodeFilter,
	parseAnimeEpisode,
	parseAnimeEpisodeFilter,
	summarizeAnimeEpisodes,
} from './animeEpisodes';

type Stored = { filename?: string; title?: string };
const namesOf = (rows: Stored[]) => rows.map((r) => r.filename ?? r.title ?? '');

describe('parseAnimeEpisode', () => {
	// Each name is a production release, one per shape; see the fixture README.
	it.each(names.map((n) => [n.name, n.expected] as const))('reads %s', (name, expected) => {
		expect(parseAnimeEpisode(name)).toEqual(expected);
	});

	it('reads nothing from an empty name', () => {
		expect(parseAnimeEpisode('')).toBeNull();
	});
});

describe('summarizeAnimeEpisodes over whole production rows', () => {
	// Frieren's first season has 28 episodes. Every one of its 772 stored names
	// that names an episode must land on 1-28, and every episode must be found.
	it("files Frieren's 772 releases under exactly episodes 1 to 28", () => {
		const summary = summarizeAnimeEpisodes(namesOf(frieren as Stored[]));

		expect(summary.episodes.map((e) => e.episode)).toEqual(
			Array.from({ length: 28 }, (_, i) => i + 1)
		);
		expect(summary.batches).toBe(39);
		expect(summary.unnumbered).toBe(9);
		const counted =
			summary.episodes.reduce((n, e) => n + e.count, 0) +
			summary.batches +
			summary.unnumbered;
		expect(counted).toBe(frieren.length);
	});

	// SubsPlease `S4 - 23`, Erai `Ryushu no Youjo - 23`, Ironclad `S04E23` and
	// Onalrie `S01E23` are one episode; the season marker is not part of it.
	it("files Bookworm's fourth season under its own numbering whatever the group calls the season", () => {
		const summary = summarizeAnimeEpisodes(namesOf(bookworm4 as Stored[]));

		expect(summary.episodes.map((e) => e.episode)).toEqual([
			11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
		]);
		expect(summary.episodes.find((e) => e.episode === 23)?.count).toBe(12);
		expect(summary.batches).toBe(1);
		expect(summary.unnumbered).toBe(0);
	});

	it('reads the absolute numbering of a long-running ONA with no IMDb id', () => {
		const summary = summarizeAnimeEpisodes(namesOf(dou as Stored[]));

		expect(summary.unnumbered).toBe(0);
		expect(summary.episodes.length).toBeGreaterThan(80);
		expect(summary.episodes.at(-1)!.episode).toBeLessThan(300);
	});
});

describe('matchesAnimeEpisodeFilter', () => {
	const frierenNames = namesOf(frieren as Stored[]);

	it('keeps single-episode releases of that episode and leaves the packs out', () => {
		const five = frierenNames.filter((n) => matchesAnimeEpisodeFilter(n, 5));

		expect(five.length).toBe(26);
		expect(five).toContain('[SubsPlease] Sousou no Frieren - 05 (1080p) [8E3F8FA5].mkv');
		expect(five.some((n) => /01 ~ 28/.test(n))).toBe(false);
	});

	it('selects the packs, and the names that carry neither', () => {
		expect(frierenNames.filter((n) => matchesAnimeEpisodeFilter(n, 'batch'))).toHaveLength(39);
		expect(frierenNames.filter((n) => matchesAnimeEpisodeFilter(n, 'unnumbered'))).toHaveLength(
			9
		);
	});
});

describe('parseAnimeEpisodeFilter', () => {
	it.each([
		['5', 5],
		['0', 0],
		['1100', 1100],
		['batch', 'batch'],
		['unnumbered', 'unnumbered'],
	] as const)('reads %s', (raw, expected) => {
		expect(parseAnimeEpisodeFilter(raw)).toBe(expected);
	});

	it.each([undefined, '', '-1', '5.5', 'abc', '99999', ['5']])('refuses %j', (raw) => {
		expect(parseAnimeEpisodeFilter(raw)).toBeNull();
	});
});
