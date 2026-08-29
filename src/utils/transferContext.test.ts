import { describe, expect, it } from 'vitest';
import {
	mediaTypeFromImdbTitleType,
	safeReturnPath,
	seasonFromReleaseName,
	transferContextFromPath,
} from './transferContext';

describe('transferContextFromPath', () => {
	it('reads a movie page', () => {
		expect(transferContextFromPath('/movie/tt1234567')).toEqual({ mediaType: 'movie' });
	});

	it('reads a show page and its season', () => {
		expect(transferContextFromPath('/show/tt1234567/3')).toEqual({
			mediaType: 'tv',
			seasonNum: 3,
		});
	});

	it('answers undefined for anything else, so nothing is filed under a guess', () => {
		expect(transferContextFromPath(undefined)).toBeUndefined();
		expect(transferContextFromPath('/library')).toBeUndefined();
		expect(transferContextFromPath('/show/tt1234567')).toBeUndefined();
	});
});

describe('safeReturnPath', () => {
	it('accepts the two shapes DMM produces', () => {
		expect(safeReturnPath('/movie/tt1234567')).toBe('/movie/tt1234567');
		expect(safeReturnPath('/show/tt1234567/12')).toBe('/show/tt1234567/12');
	});

	// A stored returnPath is rendered straight into a `<Link href>` and comes from
	// whoever called the submit route, so this is an allowlist rather than a
	// sanitiser — there is no next trick to find.
	it.each([
		['an absolute URL', 'https://evil.example/steal'],
		['a protocol-relative URL', '//evil.example'],
		['a backslash-relative URL', '/\\evil.example'],
		['a javascript scheme', 'javascript:alert(1)'],
		['a path traversal', '/movie/tt1234567/../../admin'],
		['a query string', '/movie/tt1234567?next=//evil.example'],
		['a fragment', '/movie/tt1234567#x'],
		['a trailing segment', '/movie/tt1234567/extra'],
		['an unrelated page', '/library'],
		['a non-string', 42],
		['nothing', undefined],
	])('rejects %s', (_label, value) => {
		expect(safeReturnPath(value)).toBeUndefined();
	});

	it('rejects an imdb id outside the real length range', () => {
		expect(safeReturnPath('/movie/tt1')).toBeUndefined();
		expect(safeReturnPath('/movie/tt12345678901')).toBeUndefined();
	});

	it('only stores what transferContextFromPath can then parse', () => {
		// The two must agree, or a transfer passes validation and is still filed
		// nowhere when it completes.
		for (const path of ['/movie/tt1234567', '/show/tt1234567/2']) {
			expect(transferContextFromPath(safeReturnPath(path))).toBeDefined();
		}
	});
});

describe('seasonFromReleaseName', () => {
	it.each([
		['The.Traitors.NZ.S03E01.1080p.AMZN.WEB.DL.DDP2.0.H.264-Kitsune', 3],
		['Conan.OBrien.Must.Go.S01.1080p.WEB.H264-SuccessfulCrab', 1],
		['Some.Show.Season 12.1080p.WEB-DL', 12],
		['Some.Show.Season.4.COMPLETE.1080p', 4],
		['Some.Show.3x05.720p.HDTV', 3],
	])('reads the season out of %s', (name, expected) => {
		expect(seasonFromReleaseName(name)).toBe(expected);
	});

	// Each of these puts digits next to an `s` or an `x` without naming a season.
	// A false positive files a whole season pack under a page it does not belong
	// on, which is worse than not filing it.
	it.each([
		['a channel layout', 'Show.Name.2160p.UHD.BDRip.TrueHD.Atmos.7.1.x265-GRP'],
		['a subtitle tag', 'Show.Name.1080p.NL.Subs.2160p.WEB-DL'],
		['a codec', 'Show.Name.1080p.WEB-DL.DDP5.1.H.265-GRP'],
		['a date-stamped episode', 'WCW.Monday.Nitro.1996.08.05.540p.WEBRip.h264'],
		['nothing at all', 'Some.Movie.1998.BluRay.1080p.AVC.REMUX-GRP'],
		['no name', undefined],
	])('does not invent a season from %s', (_label, name) => {
		expect(seasonFromReleaseName(name)).toBeUndefined();
	});

	it('prefers the Sxx marker over a later x-form', () => {
		expect(seasonFromReleaseName('Show.S02.Part.3x04.1080p')).toBe(2);
	});
});

describe('mediaTypeFromImdbTitleType', () => {
	it.each([
		['tvSeries', 'tv'],
		['tvMiniSeries', 'tv'],
		['movie', 'movie'],
		// These live on a /movie/tt… page in DMM despite the "tv" prefix, and have
		// no season to file under.
		['tvMovie', 'movie'],
		['tvSpecial', 'movie'],
		['video', 'movie'],
		['short', 'movie'],
	])('maps %s to a %s page', (titleType, expected) => {
		expect(mediaTypeFromImdbTitleType(titleType)).toBe(expected);
	});

	it.each([['tvEpisode'], ['videoGame'], [null], [undefined], ['']])(
		'has no page for %s',
		(titleType) => {
			expect(mediaTypeFromImdbTitleType(titleType)).toBeUndefined();
		}
	);
});
