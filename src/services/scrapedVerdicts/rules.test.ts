import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/labelled-filenames.json';
import {
	decide,
	decideWithoutModel,
	fold,
	foundTitles,
	type Media,
	type MovieContext,
	type TitleMatch,
	yearsIn,
} from './rules';

/**
 * 600 real filenames from the pages of IMDb's ten most popular movies on
 * 2026-09-27, each with Jev's recorded answers, the verdict the original Python
 * rules gave, and a human label. `tuning` is the set the rules were shaped on;
 * `holdout` was drawn afterwards from every stored pair and labelled before any
 * prediction was looked at.
 */
type Item = {
	set: 'tuning' | 'holdout';
	imdbId: string;
	filename: string;
	media: Media;
	titleMatch: TitleMatch;
	expected: 'KEEP' | 'DELETE';
	humanLabel: 'MOVIE' | 'PACK' | 'AMBIG' | 'EITHER' | 'OTHER';
};

const movies = fixture.movies as Record<
	string,
	{ name: string; year: number; titles: string[]; ambiguous: Record<string, number[]> }
>;
const items = fixture.items as Item[];
const context = (imdbId: string): MovieContext => ({ imdbId, ...movies[imdbId] });

describe('scraped-result verdict rules', () => {
	it('reproduces every verdict of the rules they were ported from', () => {
		const mismatches = items
			.map((item) => ({
				item,
				got: decide(context(item.imdbId), item.filename, item.media, item.titleMatch),
			}))
			.filter(({ item, got }) => (got === 'keep' ? 'KEEP' : 'DELETE') !== item.expected)
			.map(({ item, got }) => `${got}: ${item.filename}`);
		expect(mismatches).toEqual([]);
	});

	it('agrees with the human labels on at least 98% of the holdout', () => {
		const holdout = items.filter((item) => item.set === 'holdout');
		const agreed = holdout.filter((item) => {
			if (item.humanLabel === 'EITHER') return true;
			const verdict = decide(
				context(item.imdbId),
				item.filename,
				item.media,
				item.titleMatch
			);
			return (verdict === 'trash') === (item.humanLabel === 'OTHER');
		});
		expect(holdout).toHaveLength(300);
		expect(agreed.length / holdout.length).toBeGreaterThanOrEqual(0.98);
	});

	it('only skips the model when every possible answer gives the same verdict', () => {
		for (const item of items) {
			const movie = context(item.imdbId);
			const settled = decideWithoutModel(movie, item.filename);
			if (settled !== null) {
				expect(decide(movie, item.filename, item.media, item.titleMatch)).toBe(settled);
			}
		}
	});

	it('matches titles as whole words, so a plural is a different title', () => {
		expect(foundTitles('Barbarians.2022.1080p.WEBRip', ['Barbarian'])).toEqual([]);
		expect(foundTitles('Barbarian.2022.1080p.WEBRip', ['Barbarian'])).toEqual(['Barbarian']);
		expect(
			foundTitles('Shawshank.Redemption.1994.BD.Remux', ['The Shawshank Redemption'])
		).toEqual(['The Shawshank Redemption']);
		expect(foundTitles('肖申克的救赎.1994.720p', ['肖申克的救赎'])).toEqual(['肖申克的救赎']);
		expect(fold('Le Ali della Libertà')).toBe(' le ali della liberta ');
	});

	it('trashes a release whose year points at the other work sharing an alias', () => {
		const ministry = context('tt5177120');
		expect(decide(ministry, 'Your.Lucky.Day.2023.720p.AMZN.WEBRip', 'FILM', 'SAME_TITLE')).toBe(
			'trash'
		);
		expect(
			decide(
				ministry,
				'The.Ministry.of.Ungentlemanly.Warfare.2024.1080p',
				'FILM',
				'SAME_TITLE'
			)
		).toBe('keep');
	});

	it('does not treat a game repack as a movie pack', () => {
		const re = context('tt0120804');
		expect(
			decide(
				re,
				'Resident Evil 7: Biohazard [FitGirl Repack]',
				'GAME_SOFTWARE',
				'DIFFERENT_TITLE'
			)
		).toBe('trash');
		expect(decide(re, 'Resident Evil Collection', 'FILM', 'DIFFERENT_TITLE')).toBe('keep');
	});
});

describe('year extraction', () => {
	// Real filenames from the Captain America: Civil War page, trashed in
	// production on 2026-09-27 because BT.2020, the HDR colour space, read as a
	// release year four years off the movie's.
	const civilWar: MovieContext = {
		imdbId: 'tt3498820',
		name: 'Captain America: Civil War',
		year: 2016,
		titles: ['Captain America: Civil War', 'Capitão América: Guerra Civil'],
		ambiguous: {},
	};

	it.each([
		'Captain.America.Civil.War.HDR.1080p.HEVC.10bit.BT.2020.DTS-HD.MA.7.1-Мастер5.mkv',
		'Captain.America.Civil.War.HDR.1080p.HEVC.10bit.BT.2020.DTS-HD.MA-VISIONPLUSHDR1000.mp4.',
		'Capitão.America.Guerra.Civil.HDR.2160p REMASTERIZADO 4K.HEVC.10bit.BT.2020.DUAL AUDIO 5.1 ENCODER BY',
	])('does not read a colour space as a year: %s', (filename) => {
		expect(yearsIn(filename)).toEqual([]);
		expect(decideWithoutModel(civilWar, filename)).not.toBe('trash');
	});

	it('does not read a resolution or a size as a year', () => {
		expect(yearsIn('Frankenstein Family 03-06 (1920x1080 HEVC2 AAC)')).toEqual([]);
		expect(yearsIn('Movie 2048 x 858 Rec.2020 1900MB')).toEqual([]);
		expect(yearsIn('Civil.War.2016.UHD.BT2020.1920x1080')).toEqual([2016]);
		expect(yearsIn('The Dark Knight 2008DVDScrENG')).toEqual([2008]);
	});

	// Real filenames from production: the resolution guard first read the
	// codec after the year ("2014 x264") as a width x height.
	it.each([
		['Sleeping Beauty 2014 x264 720p Esub BluRay Dual Audio English Hindi GOPISAHI', [2014]],
		['Moon 2001 X265', [2001]],
		['Movie 2019 x266 1080p', [2019]],
		['[SOFCJ-Raws] Detective Conan Movie 24 - The Scarlet Bullet (BDRip 1920x1080 x264', []],
	])('still reads a year that a codec follows: %s', (filename, years) => {
		expect(yearsIn(filename)).toEqual(years);
	});
});
