import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/labelled-filenames.json';
import substringKeeps from './__fixtures__/substring-keeps.json';
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
	// `expected` started as the verdicts of the Python rules these were ported
	// from. A deliberate rule change updates it item by item, never wholesale.
	it('gives the recorded verdict for every labelled filename', () => {
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

/**
 * Real filenames trashed in production on 2026-09-27, each with the context
 * `getMovieContext` built for its page that day (titles trimmed to the ones
 * that matter).
 */
describe('verdicts that production got wrong on day one', () => {
	it('keeps a release once a same-name video game no longer counts as another work', () => {
		// The 2003 video game "Pirates of the Caribbean" used to sit in
		// `ambiguous` and trash the 2003 film's own releases; games are now left
		// out when the context is built, so the alias is not ambiguous at all.
		const pirates: MovieContext = {
			imdbId: 'tt0325980',
			name: 'Pirates of the Caribbean: The Curse of the Black Pearl',
			year: 2003,
			titles: [
				'Pirates of the Caribbean',
				'Pirates of the Caribbean: The Curse of the Black Pearl',
			],
			ambiguous: {},
		};
		expect(
			decide(pirates, 'Pirates of the Caribbean (2003).BRRIP.X264-ISAS', 'FILM', 'SAME_TITLE')
		).toBe('keep');
	});

	it('still trashes on a tie with another film sharing the alias and the year', () => {
		const ongBak: MovieContext = {
			imdbId: 'tt0368909',
			name: 'Ong-Bak: The Thai Warrior',
			year: 2003,
			titles: ['Ong-Bak: The Thai Warrior', 'Daredevil'],
			ambiguous: { daredevil: [1919, 1968, 2003, 2007, 2015, 2023] },
		};
		expect(decideWithoutModel(ongBak, 'Daredevil 2003 DirCut 720p Brrip Xvid AC3-LmB')).toBe(
			'trash'
		);
	});

	it('finds a title whose ampersand the release dropped', () => {
		const lostAndFound: MovieContext = {
			imdbId: 'tt0120836',
			name: 'Lost & Found',
			year: 1999,
			titles: ['Lost & Found', 'Perdido & encontrado'],
			ambiguous: {},
		};
		expect(
			foundTitles('Lost Found (1999) [1080p] [WEBRip] [5.1] [YTS.MX]', lostAndFound.titles)
		).toEqual(['Lost & Found']);
		expect(
			decide(
				lostAndFound,
				'Lost Found (1999) [1080p] [WEBRip] [5.1] [YTS.MX]',
				'FILM',
				'NO_TITLE'
			)
		).toBe('keep');
	});

	it.each([
		[
			1993,
			'Сильвестр Сталлоне: Фильмография / Sylvester Stallone: Filmography (1975-2013) BDRip 720p',
		],
		[2018, 'ALL Best Picture Nominees 1080p BluRay Part 3 of 3 2015-2023 82 Movies jZQ'],
		[2008, 'Marvel.Cinematic.Universe.Phases.1-3.1080p.BluRay.HDR10.10Bit.DDP5.1.HEVC-d3g'],
		[2003, 'Pirates Of The Carribean - All 4 movies - mp4'],
	])('keeps a pack that spans the movie: %s %s', (year, filename) => {
		const movie: MovieContext = {
			imdbId: 'tt1',
			name: 'x',
			year,
			titles: ['x'],
			ambiguous: {},
		};
		expect(decide(movie, filename, 'FILM', 'NO_TITLE')).toBe('keep');
	});

	it.each([
		[
			'tt0067369',
			1971,
			['Der lüsterne Türke'],
			'Der.lusterne.Turke.1971.DVDRip.x264-Flipper.mkv',
		],
		[
			'tt0070543',
			1974,
			['Fun for Three', 'How to Seduce a Virgin'],
			'How to Seduce a Virgin 1973 1080p BluRay REMUX AVC UNCUT DTS HD-MA 2 0-RaZoR',
		],
		[
			'tt1365048',
			2011,
			['3-D Sex and Zen: Extreme Ecstasy', 'Sex and Zen Extreme Ecstasy'],
			'Sex And Zen Extreme Ecstasy 2011 1080p GER Blu-ray AVC DTS-HD MA 7.1-K4miK4z3',
		],
	])('keeps an adult film’s own releases on its page: %s', (imdbId, year, titles, filename) => {
		const movie: MovieContext = { imdbId, name: titles[0], year, titles, ambiguous: {} };
		expect(decide(movie, filename, 'ADULT', 'SAME_TITLE')).toBe('keep');
	});

	it('does not read a year in front of "Movies" as a pack size', () => {
		// Real, on the Rogue One page: "2017 Movies" is an uploader tag.
		const rogueOne: MovieContext = {
			imdbId: 'tt3748528',
			name: 'Rogue One: A Star Wars Story',
			year: 2016,
			titles: ['Rogue One', 'Rogue One: A Star Wars Story'],
			ambiguous: { 'rogue one': [2017] },
		};
		expect(
			decide(
				rogueOne,
				'Super Dark Times 2017 Movies HDRip XviD 5 1 AAC with Sample',
				'FILM',
				'NO_TITLE'
			)
		).toBe('trash');
	});

	it('does not let a very short alias make adult content the movie', () => {
		// Real, on the Mother (2009) page: its Turkish title "Ana" is a name.
		const mother: MovieContext = {
			imdbId: 'tt1216496',
			name: 'Mother',
			year: 2009,
			titles: ['Mother', 'Madeo', 'Ana'],
			ambiguous: {},
		};
		expect(
			decide(
				mother,
				'Shemale-Club.com - Ana Paula Samadhi - Nycoly Spyleer - 11.21.2009',
				'ADULT',
				'SAME_TITLE'
			)
		).toBe('trash');
		const anita: MovieContext = {
			imdbId: 'tt0069718',
			name: 'Anita',
			year: 1973,
			titles: ['Anita'],
			ambiguous: {},
		};
		expect(decide(anita, 'Anita (1973) VHSRip Oldies', 'ADULT', 'SAME_TITLE')).toBe('keep');
	});

	it('still trashes adult content that is not the movie', () => {
		const movie: MovieContext = {
			imdbId: 'tt8367814',
			name: 'The Gentlemen',
			year: 2019,
			titles: ['The Gentlemen'],
			ambiguous: {},
		};
		expect(
			decide(
				movie,
				'MissaX 19 08 02 Kira Noir The Gentleman Part 4 1080p',
				'ADULT',
				'DIFFERENT_TITLE'
			)
		).toBe('trash');
		expect(decide(movie, 'The Gentlemen 2019 [XXX] parody', 'ADULT', 'SAME_TITLE')).toBe(
			'trash'
		);
		// Real, from the Dude (2025) page: a title word and the year are not enough.
		const dude: MovieContext = {
			imdbId: 'tt36388163',
			name: 'Dude',
			year: 2025,
			titles: ['Dude'],
			ambiguous: {},
		};
		expect(
			decide(
				dude,
				'RKPrime - Reyna Belle - Surfer Dude Bags Bodacious Babe (19 05 2025) rq mp4',
				'ADULT',
				'DIFFERENT_TITLE'
			)
		).toBe('trash');
	});
});

type KeepItem = {
	set: 'random' | 'trashed' | 'no-title' | 'warfare';
	imdbId: string;
	filename: string;
	media: Media;
	titleMatch: TitleMatch;
	humanLabel: 'MOVIE' | 'PACK' | 'OTHER' | 'EITHER';
};

/**
 * Real keep verdicts read from production on 2026-10-04, each one a title of
 * the movie found as whole words somewhere in the filename overruling Jev's
 * NO_TITLE or DIFFERENT_TITLE. The fixture's `_about` says how each set was
 * drawn and labelled; every item was a keep in production.
 */
describe('a movie title found inside another title', () => {
	const keepItems = substringKeeps.items as KeepItem[];
	const pages = substringKeeps.movies as Record<
		string,
		{ name: string; year: number; titles: string[] }
	>;
	const pageOf = (imdbId: string): MovieContext => ({ imdbId, ambiguous: {}, ...pages[imdbId] });
	const kept = (items: KeepItem[]) =>
		items
			.filter(
				(item) =>
					decide(pageOf(item.imdbId), item.filename, item.media, item.titleMatch) ===
					'keep'
			)
			.map((item) => item.filename);
	const isTheMovie = (item: KeepItem) =>
		item.humanLabel === 'MOVIE' || item.humanLabel === 'PACK';

	it('no longer files The Ministry of Ungentlemanly Warfare under Warfare (2025) when Jev saw no title', () => {
		const ministry = keepItems.filter(
			(item) =>
				item.set === 'warfare' &&
				item.titleMatch === 'NO_TITLE' &&
				/ministry/i.test(item.filename)
		);
		expect(ministry).toHaveLength(72);
		expect(kept(ministry)).toEqual([]);
	});

	it('trashes every NO_TITLE release on 400 random pages that carries a title only inside its own', () => {
		const noTitle = keepItems.filter((item) => item.set === 'no-title');
		expect(noTitle).toHaveLength(97);
		expect(kept(noTitle)).toEqual([]);
	});

	it('no longer files The Ministry of Ungentlemanly Warfare under Warfare (2025) when Jev read another title', () => {
		const ministry = keepItems.filter(
			(item) =>
				item.set === 'warfare' &&
				item.titleMatch === 'DIFFERENT_TITLE' &&
				/ministry/i.test(item.filename)
		);
		expect(ministry).toHaveLength(7);
		expect(kept(ministry)).toEqual([]);
	});

	// Measured both ways on 160 of the 2,222 such keeps on 400 random pages: 95
	// were another work, 59 the movie or a pack holding it.
	it('trashes over half the other works in a random sample of these keeps and keeps 90% of the movie', () => {
		const sample = keepItems.filter((item) => item.set === 'random');
		const others = sample.filter((item) => item.humanLabel === 'OTHER');
		const movies = sample.filter(isTheMovie);
		expect([others.length, movies.length]).toEqual([95, 59]);
		expect(1 - kept(others).length / others.length).toBeGreaterThan(0.5);
		expect(kept(movies).length / movies.length).toBeGreaterThanOrEqual(0.9);
	});

	it('is right about at least 90% of the DIFFERENT_TITLE keeps it trashes', () => {
		const sample = keepItems.filter(
			(item) => item.set === 'trashed' && item.humanLabel !== 'EITHER'
		);
		const keptNow = new Set(kept(sample));
		const trashed = sample.filter((item) => !keptNow.has(item.filename));
		const others = sample.filter((item) => item.humanLabel === 'OTHER');
		expect(kept(others)).toEqual([]);
		expect(others.length / trashed.length).toBeGreaterThanOrEqual(0.9);
	});

	it.each([
		['tt0070047', 'The Exorcist Extended Directors Cut [1973] 720p MKV Dellefs0'],
		[
			'tt3300542',
			'Objetivo Londres (2016) [BluRay 720p X264 MKV][AC3 5.1 Castellano][www.nucleo.com]',
		],
		['tt0409459', 'Watchmen - ศึกซูเปอร์ฮีโร่พันธุ์มหากาฬ [2009] [1080p]'],
		['tt5144174', 'Sucho / The Dry (2020)(CZ) = CSFD 68%'],
	])(
		'keeps DIFFERENT_TITLE when one of its titles starts the release: %s %s',
		(imdbId, filename) => {
			expect(decide(pageOf(imdbId), filename, 'FILM', 'DIFFERENT_TITLE')).toBe('keep');
		}
	);

	it.each([
		['tt2231461', 'London.Rampage.2018.WEBRip.x264-ION10'],
		['tt1103153', 'Lesbian Vampire Killers 2009 1080p BluRay HEVC x265 5.1 BONE'],
		// The release group, after the year and the tags, not a title.
		['tt1922777', 'John Carter (2012)  720p HDDRiP AC3  - SiNiSTER'],
		// After a colon comes a subtitle, not a second title.
		[
			'tt31434639',
			'Pán prstenů: Válka Rohirů / The Lord of the Rings: The War of the Rohirrim (2024)(CZ/EN)[1080p][WEB-DL][HDR10][HEVC] = CSFD 62%',
		],
	])(
		'trashes DIFFERENT_TITLE when its title only sits inside the release title: %s %s',
		(imdbId, filename) => {
			expect(decide(pageOf(imdbId), filename, 'FILM', 'DIFFERENT_TITLE')).toBe('trash');
		}
	);

	it.each([
		// Real, each with its page's title; tags before the year are a prefix.
		[
			{ imdbId: 'tt0112442', name: 'Bad Boys', year: 1995 },
			'[BDRM Remux] Bad Boys 1-2 (1995-2003)',
		],
		[
			{ imdbId: 'tt8093700', name: 'The Woman King', year: 2022 },
			'【高清影视之家发布 www.HDBTHD.com】达荷美女战士[HDR+杜比视界双版本][简繁英字幕].The.Woman.King.2022.2160p.UHD.BluRay.x265.10bit.DV.TrueHD.7.1.Atmos-SONYHD',
		],
	])('keeps DIFFERENT_TITLE behind a bracketed prefix of tags: %s %s', (page, filename) => {
		const movie: MovieContext = { ...page, titles: [page.name], ambiguous: {} };
		expect(decide(movie, filename, 'FILM', 'DIFFERENT_TITLE')).toBe('keep');
	});

	it.each([
		['tt0094961', 'Smrtelné horko / Dead Heat (1988)(CZ/EN)[1080p] = CSFD 59%'],
		['tt1620981', 'COMANDO.TO - A Família Addams 2020 [1080p-FULL] [DUAL]'],
		[
			'tt14948432',
			'【高清影视之家发布 www.HDBTHD.com】红色一号：冬日行动[简繁英字幕].Red.One.2024.2160p.AMZN.WEB-DL.DDP5.1.Atmos.H265-ParkHD',
		],
		[
			'tt0096969',
			'Urodzony czwartego lipca   Born on the Fourth of July (1989) PL.1080p.BRRip.x264-wasik   Lektor PL.mkv.ts',
		],
	])(
		'still overrules NO_TITLE when the title it found is the release title: %s %s',
		(imdbId, filename) => {
			expect(decide(pageOf(imdbId), filename, 'FILM', 'NO_TITLE')).toBe('keep');
		}
	);

	it('reads a quality tag before the year as a prefix, not the end of the name', () => {
		// Real, on the Atlas (2024) page.
		const atlas: MovieContext = {
			imdbId: 'tt14856980',
			name: 'Atlas',
			year: 2024,
			titles: ['Atlas'],
			ambiguous: {},
		};
		expect(decide(atlas, '[1080p] Atlas (2024) ล่าข้ามจักรวาล', 'FILM', 'NO_TITLE')).toBe(
			'keep'
		);
	});
});
