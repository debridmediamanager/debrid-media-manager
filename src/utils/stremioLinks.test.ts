import { describe, expect, it } from 'vitest';
import { getStremioDetailUrl } from './stremioLinks';

describe('getStremioDetailUrl', () => {
	it('builds movie detail links with the triple-slash scheme', () => {
		expect(getStremioDetailUrl('tt5198068')).toBe(
			'stremio:///detail/movie/tt5198068/tt5198068'
		);
	});

	it('builds series detail links with season and episode numbers', () => {
		expect(getStremioDetailUrl('tt1234567', { season: 2, episode: 5 })).toBe(
			'stremio:///detail/series/tt1234567/tt1234567:2:5'
		);
	});
});
