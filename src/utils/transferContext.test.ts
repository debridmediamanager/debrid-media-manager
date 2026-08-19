import { describe, expect, it } from 'vitest';
import { safeReturnPath, transferContextFromPath } from './transferContext';

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
