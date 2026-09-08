import { describe, expect, it } from 'vitest';
import {
	MAX_OTHER_STREAMS_LIMIT,
	SPONSOR_MAX_OTHER_STREAMS_LIMIT,
	maxOtherStreamsLimit,
	otherStreamsLimitChoices,
	otherStreamsLimitLabel,
} from './sponsorLimits';

describe('maxOtherStreamsLimit', () => {
	it('caps a non-sponsor at the standard limit', () => {
		expect(maxOtherStreamsLimit(false)).toBe(MAX_OTHER_STREAMS_LIMIT);
	});

	it('raises a sponsor to the sponsor limit', () => {
		expect(maxOtherStreamsLimit(true)).toBe(SPONSOR_MAX_OTHER_STREAMS_LIMIT);
	});
});

describe('otherStreamsLimitChoices', () => {
	const values = (isSponsor: boolean, current?: number) =>
		otherStreamsLimitChoices(isSponsor, current).map((c) => c.value);
	const locked = (isSponsor: boolean, current?: number) =>
		otherStreamsLimitChoices(isSponsor, current)
			.filter((c) => c.sponsorOnly)
			.map((c) => c.value);

	// The sponsor range used to be absent from a non-sponsor's list, which left
	// nothing on screen to say the limit went past 5.
	it('shows a non-sponsor the whole range, locking what a sponsorship opens', () => {
		expect(values(false)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(locked(false)).toEqual([6, 7, 8, 9, 10]);
	});

	it('locks nothing for a sponsor', () => {
		expect(values(true)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(locked(true)).toEqual([]);
	});

	// A sponsor who picked 10 and then lapsed still has 10 stored. It stays in
	// the list, and stays locked: the select has to show what the profile holds
	// without offering it back.
	it('keeps a lapsed sponsor stored value on screen and locked', () => {
		expect(values(false, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(locked(false, 10)).toContain(10);
	});

	it('adds a stored value from beyond the sponsor ceiling', () => {
		expect(values(false, 12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]);
		expect(locked(false, 12)).toContain(12);
	});

	it('does not duplicate a stored value already in range', () => {
		expect(values(true, 4)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	});

	it('ignores a non-integer stored value', () => {
		expect(values(false, NaN)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	});
});

describe('otherStreamsLimitLabel', () => {
	it('names the zero case rather than counting it', () => {
		expect(otherStreamsLimitLabel({ value: 0, sponsorOnly: false })).toBe(
			"Don't show other streams"
		);
	});

	it('keeps one stream singular', () => {
		expect(otherStreamsLimitLabel({ value: 1, sponsorOnly: false })).toBe('1 stream');
	});

	it('says which values a sponsorship opens', () => {
		expect(otherStreamsLimitLabel({ value: 10, sponsorOnly: true })).toBe(
			'10 streams (sponsors only)'
		);
		expect(otherStreamsLimitLabel({ value: 10, sponsorOnly: false })).toBe('10 streams');
	});
});
