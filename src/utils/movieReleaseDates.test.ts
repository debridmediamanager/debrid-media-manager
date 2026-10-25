import { describe, expect, it } from 'vitest';
import {
	addDaysIso,
	extractDigitalReleaseDate,
	formatReleaseDate,
	getExpectedDigitalReleaseDate,
	isIsoDateOnOrBeforeToday,
	isMovieDigitallyReleased,
	upcomingDigitalRelease,
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

	describe('upcoming digital release chip', () => {
		const today = new Date('2026-10-25T10:00:00Z');
		const at = (date: string) => formatReleaseDate(date);

		it('names a future TMDB date and an estimate apart', () => {
			expect(
				upcomingDigitalRelease(
					{
						year: '2026',
						expectedDigitalReleaseDate: '2026-11-17',
						expectedDigitalReleaseSource: 'tmdb',
					},
					today
				)?.label
			).toBe(`Digital ${at('2026-11-17')}`);
			const estimate = upcomingDigitalRelease(
				{
					year: '2026',
					expectedDigitalReleaseDate: '2027-01-29',
					expectedDigitalReleaseSource: 'estimated',
				},
				today
			);
			expect(estimate?.label).toBe(`Digital ~${at('2027-01-29')}`);
			expect(estimate?.title).toMatch(/estimate/);
		});

		it('says nothing once the date has passed', () => {
			const info = {
				year: '2026',
				expectedDigitalReleaseDate: '2026-10-25',
				expectedDigitalReleaseSource: 'tmdb' as const,
			};
			expect(upcomingDigitalRelease(info, today)).toBeNull();
			expect(isMovieDigitallyReleased(info, today)).toBe(true);
		});

		// Production served these on 2026-10-25: The Godfather (1972) with a TMDB
		// digital date to come, and The Wizard of Oz (1939) with a 1939 estimate.
		it.each([
			['1972', '2026-12-13', 'tmdb', false],
			['1939', '1939-10-05', 'estimated', false],
		] as const)('treats a %s film as long released', (year, date, source, available) => {
			const info = {
				year,
				expectedDigitalReleaseDate: date,
				expectedDigitalReleaseSource: source,
				digitalReleaseAvailable: available,
			};
			expect(upcomingDigitalRelease(info, today)).toBeNull();
			expect(isMovieDigitallyReleased(info, today)).toBe(true);
		});

		it('still shows a future date for a film from the last two years', () => {
			expect(
				upcomingDigitalRelease(
					{
						year: '2024',
						expectedDigitalReleaseDate: '2026-12-01',
						expectedDigitalReleaseSource: 'tmdb',
					},
					today
				)
			).not.toBeNull();
		});
	});
});
