import {
	categoriesFor,
	matchesCategoryFilter,
	parseCategoryFilter,
} from '@/services/torznab/categories';
import { describe, expect, it } from 'vitest';

describe('categoriesFor', () => {
	it('always carries the parent alongside the subcategory', () => {
		expect(categoriesFor('movie', 'Some.Film.2019.1080p.WEB-DL')).toEqual([2000, 2040]);
		expect(categoriesFor('tv', 'Some.Show.S01E01.2160p.WEB')).toEqual([5000, 5045]);
	});

	it('reads the resolution off the title', () => {
		expect(categoriesFor('movie', 'Film.2160p.BluRay')).toEqual([2000, 2045]);
		expect(categoriesFor('movie', 'Film.4K.HDR')).toEqual([2000, 2045]);
		expect(categoriesFor('movie', 'Film.720p.WEB')).toEqual([2000, 2040]);
		expect(categoriesFor('movie', 'Film.1080i.HDTV')).toEqual([2000, 2040]);
		expect(categoriesFor('movie', 'Film.480p.DVDRip')).toEqual([2000, 2030]);
	});

	it('prefers UHD when a title names two resolutions', () => {
		expect(categoriesFor('tv', 'Show.S01.2160p.and.1080p.pack')).toEqual([5000, 5045]);
	});

	it('leaves an untagged title with the parent only', () => {
		// Guessing SD here would hide the release from a client that mapped only
		// the HD and UHD subcategories.
		expect(categoriesFor('movie', 'Some.Film.REMUX.DTS-HD')).toEqual([2000]);
		expect(categoriesFor('tv', 'Some.Show.Complete.Series')).toEqual([5000]);
	});
});

describe('parseCategoryFilter', () => {
	it('reads a comma-separated id list', () => {
		expect(parseCategoryFilter('2000,2040, 5000')).toEqual([2000, 2040, 5000]);
	});

	it('drops junk rather than failing the search', () => {
		expect(parseCategoryFilter('2000,,abc,-1,0')).toEqual([2000]);
		expect(parseCategoryFilter('')).toEqual([]);
	});
});

describe('matchesCategoryFilter', () => {
	it('treats an empty filter as no opinion', () => {
		expect(matchesCategoryFilter([2000], [])).toBe(true);
	});

	it('matches a parent id against anything beneath it', () => {
		// What a client asking for `2000` means, and what Prowlarr's default
		// mapping actually sends.
		expect(matchesCategoryFilter([2000, 2045], [2000])).toBe(true);
		expect(matchesCategoryFilter([5000, 5040], [2000])).toBe(false);
	});

	it('matches an exact subcategory', () => {
		expect(matchesCategoryFilter([2000, 2040], [2040])).toBe(true);
		expect(matchesCategoryFilter([2000, 2040], [2045])).toBe(false);
	});

	it('keeps an untagged item for a parent request and drops it for a subcategory one', () => {
		expect(matchesCategoryFilter([5000], [5000])).toBe(true);
		expect(matchesCategoryFilter([5000], [5040])).toBe(false);
	});

	it('is satisfied by any one of several requested categories', () => {
		expect(matchesCategoryFilter([5000, 5040], [2000, 5040])).toBe(true);
	});
});
