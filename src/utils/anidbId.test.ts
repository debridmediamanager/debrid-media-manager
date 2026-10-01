import { describe, expect, it } from 'vitest';
import { animePagePath, parseAnidbIdParam, parseAnimePageId } from './anidbId';

describe('parseAnidbIdParam', () => {
	// The bare id is the page; the old page's and search's spellings are read too.
	it.each([
		['17617', 17617],
		['anidb-17617', 17617],
		['anime:anidb-17617', 17617],
		['ANIDB:17617', 17617],
		[['18302'], 18302],
	])('reads %j', (raw, expected) => {
		expect(parseAnidbIdParam(raw)).toBe(expected);
	});

	it.each([undefined, '', '0', 'frieren', 'mal-52991', 'tt22248376', '17617.5', '12345678'])(
		'refuses %j',
		(raw) => {
			expect(parseAnidbIdParam(raw)).toBeNull();
		}
	);
});

describe('parseAnimePageId', () => {
	it('addresses an AniDB entry by its bare id', () => {
		expect(parseAnimePageId('anidb-17617')).toEqual({
			source: 'anidb',
			id: 17617,
			slug: 'anidb-17617',
			path: '17617',
		});
	});

	it('addresses a row with no AniDB id by its MAL id', () => {
		expect(parseAnimePageId('mal-26395')).toEqual({
			source: 'mal',
			id: 26395,
			slug: 'mal-26395',
			path: 'mal-26395',
		});
		expect(parseAnimePageId('anime:mal-26395')?.path).toBe('mal-26395');
		expect(parseAnimePageId('mal-0')).toBeNull();
	});
});

describe('animePagePath', () => {
	it('links a search id by its AniDB id, or by its MAL id when it has no other', () => {
		expect(animePagePath('anime:anidb-14727')).toBe('/anime/14727');
		expect(animePagePath('anime:mal-1278')).toBe('/anime/mal-1278');
		expect(animePagePath('tt10885406')).toBeNull();
	});
});
