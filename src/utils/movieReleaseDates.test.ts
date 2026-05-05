import { describe, expect, it } from 'vitest';
import {
	addDaysIso,
	extractDigitalReleaseDate,
	getExpectedDigitalReleaseDate,
	isIsoDateOnOrBeforeToday,
} from './movieReleaseDates';

describe('movie release date helpers', () => {
	it('prefers US digital releases from TMDB release dates', () => {
		const digitalDate = extractDigitalReleaseDate({
			results: [
				{
					iso_3166_1: 'GB',
					release_dates: [{ type: 4, release_date: '2024-04-10T00:00:00.000Z' }],
				},
				{
					iso_3166_1: 'US',
					release_dates: [
						{ type: 4, release_date: '2024-04-20T00:00:00.000Z' },
						{ type: 4, release_date: '2024-04-02T00:00:00.000Z' },
					],
				},
			],
		});

		expect(digitalDate).toBe('2024-04-02');
	});

	it('falls back to the first non-US digital release', () => {
		const digitalDate = extractDigitalReleaseDate({
			results: [
				{
					iso_3166_1: 'FR',
					release_dates: [{ type: 4, release_date: '2024-06-01T00:00:00.000Z' }],
				},
			],
		});

		expect(digitalDate).toBe('2024-06-01');
	});

	it('estimates expected digital release as theatrical plus 45 days', () => {
		expect(addDaysIso('2024-01-15', 45)).toBe('2024-02-29');
		expect(getExpectedDigitalReleaseDate('2024-01-15', '')).toEqual({
			date: '2024-02-29',
			source: 'estimated',
		});
	});

	it('uses the TMDB digital release when present', () => {
		expect(getExpectedDigitalReleaseDate('2024-01-15', '2024-02-10')).toEqual({
			date: '2024-02-10',
			source: 'tmdb',
		});
	});

	it('compares ISO dates against today', () => {
		const today = new Date('2024-03-01T10:00:00Z');

		expect(isIsoDateOnOrBeforeToday('2024-03-01', today)).toBe(true);
		expect(isIsoDateOnOrBeforeToday('2024-03-02', today)).toBe(false);
		expect(isIsoDateOnOrBeforeToday('', today)).toBe(false);
	});
});
