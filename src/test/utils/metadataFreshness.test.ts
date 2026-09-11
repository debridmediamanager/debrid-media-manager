import shawshankCinemeta from '@/test/fixtures/metadata/cinemeta-tt0111161-the-shawshank-redemption.json';
import breakingBadCinemeta from '@/test/fixtures/metadata/cinemeta-tt0903747-breaking-bad.json';
import wednesdayCinemeta from '@/test/fixtures/metadata/cinemeta-tt13443470-wednesday.json';
import thundermansCinemeta from '@/test/fixtures/metadata/cinemeta-tt37752275-clash-of-the-thundermans.json';
import shawshankMdblist from '@/test/fixtures/metadata/mdblist-tt0111161-the-shawshank-redemption.json';
import breakingBadMdblist from '@/test/fixtures/metadata/mdblist-tt0903747-breaking-bad.json';
import wednesdayMdblist from '@/test/fixtures/metadata/mdblist-tt13443470-wednesday.json';
import thundermansMdblist from '@/test/fixtures/metadata/mdblist-tt37752275-clash-of-the-thundermans.json';
import {
	RECENT_METADATA_TTL,
	cinemetaReleaseSignals,
	isMetadataStillMoving,
	mdblistReleaseSignals,
	metadataMaxAge,
} from '@/utils/metadataFreshness';
import { describe, expect, it } from 'vitest';

// The day the fixtures were captured, so every expectation below stays true
// however long after that the suite runs.
const NOW = Date.parse('2026-09-11T12:00:00Z');

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

describe('isMetadataStillMoving', () => {
	it('treats a movie released days ago as still moving', () => {
		// Released 2026-09-03. Production was serving this title's launch-week
		// score of 8.8 while every source had already settled on 4.6.
		expect(isMetadataStillMoving(mdblistReleaseSignals(thundermansMdblist), NOW)).toBe(true);
		expect(isMetadataStillMoving(cinemetaReleaseSignals(thundermansCinemeta.meta), NOW)).toBe(
			true
		);
	});

	it('treats a movie from decades ago as settled', () => {
		expect(isMetadataStillMoving(mdblistReleaseSignals(shawshankMdblist), NOW)).toBe(false);
		expect(isMetadataStillMoving(cinemetaReleaseSignals(shawshankCinemeta.meta), NOW)).toBe(
			false
		);
	});

	it('treats a show that is still airing as moving, whatever its first-air date says', () => {
		// mdblist says "Returning Series", Cinemeta writes the same fact as an
		// open-ended year range. Both first aired in 2022, outside the window.
		expect(isMetadataStillMoving(mdblistReleaseSignals(wednesdayMdblist), NOW)).toBe(true);
		expect(isMetadataStillMoving(cinemetaReleaseSignals(wednesdayCinemeta.meta), NOW)).toBe(
			true
		);
	});

	it('treats a show that ended years ago as settled', () => {
		expect(isMetadataStillMoving(mdblistReleaseSignals(breakingBadMdblist), NOW)).toBe(false);
		expect(isMetadataStillMoving(cinemetaReleaseSignals(breakingBadCinemeta.meta), NOW)).toBe(
			false
		);
	});

	it('treats an unreleased title as moving', () => {
		// The case the movie cache comment already described: a row written months
		// before release, when the synopsis is a placeholder and the poster a teaser.
		expect(isMetadataStillMoving({ released: '2027-05-01' }, NOW)).toBe(true);
		expect(isMetadataStillMoving({ year: 2027 }, NOW)).toBe(true);
		expect(isMetadataStillMoving({ status: 'In Production' }, NOW)).toBe(true);
	});

	it('reads a finished year range as its last year', () => {
		expect(isMetadataStillMoving({ year: '2008–2013' }, NOW)).toBe(false);
		expect(isMetadataStillMoving({ year: '2023–2025' }, NOW)).toBe(true);
	});

	it('treats an undated payload as settled rather than guessing', () => {
		expect(isMetadataStillMoving({}, NOW)).toBe(false);
		expect(isMetadataStillMoving({ released: null, year: null, status: null }, NOW)).toBe(
			false
		);
		expect(isMetadataStillMoving({ year: 'Unknown' }, NOW)).toBe(false);
	});

	it('survives the shapes a payload can actually arrive in', () => {
		// Wednesday's mdblist row carries a season whose air_date is still null.
		expect(mdblistReleaseSignals(wednesdayMdblist).latestEpisode).toBe('2025-08-06');
		expect(mdblistReleaseSignals(null)).toEqual({
			released: null,
			year: null,
			status: null,
			latestEpisode: null,
		});
		expect(cinemetaReleaseSignals(undefined)).toEqual({
			released: null,
			year: null,
			status: null,
			latestEpisode: null,
		});
	});
});

describe('metadataMaxAge', () => {
	it('shortens the lifetime of a title that is still moving', () => {
		expect(metadataMaxAge(mdblistReleaseSignals(thundermansMdblist), THIRTY_DAYS, NOW)).toBe(
			RECENT_METADATA_TTL
		);
		expect(metadataMaxAge(mdblistReleaseSignals(wednesdayMdblist), SEVEN_DAYS, NOW)).toBe(
			RECENT_METADATA_TTL
		);
	});

	it('leaves a settled title on the lifetime it already had', () => {
		expect(metadataMaxAge(mdblistReleaseSignals(shawshankMdblist), THIRTY_DAYS, NOW)).toBe(
			THIRTY_DAYS
		);
		expect(metadataMaxAge(mdblistReleaseSignals(breakingBadMdblist), SEVEN_DAYS, NOW)).toBe(
			SEVEN_DAYS
		);
	});

	it('never lengthens a lifetime the caller chose', () => {
		const oneHour = 60 * 60 * 1000;
		expect(metadataMaxAge(mdblistReleaseSignals(thundermansMdblist), oneHour, NOW)).toBe(
			oneHour
		);
		// 0 is this cache's spelling of "permanent", not "already expired".
		expect(metadataMaxAge(mdblistReleaseSignals(thundermansMdblist), 0, NOW)).toBe(0);
	});
});
